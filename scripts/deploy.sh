#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${DEPLOY_SOURCE_DIR:-$PROJECT_ROOT/public}"
DEPLOY_DIR="${DEPLOY_TARGET_DIR:-/var/www/omnizap}"
BACKUP_ENABLED="${DEPLOY_CREATE_BACKUP:-1}"
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-$DEPLOY_DIR/.backup}"
NGINX_SERVICE="${DEPLOY_NGINX_SERVICE:-nginx}"
RESTART_PM2="${DEPLOY_RESTART_PM2:-1}"
PM2_APP_NAME="${DEPLOY_PM2_APP_NAME:-omnizap-system-production}"
BUILD_ID="${DEPLOY_BUILD_ID:-$(date -u +%Y%m%d%H%M%S)}"
VERIFY_URL="${DEPLOY_VERIFY_URL:-https://omnizap.shop/}"
DRY_RUN="${DEPLOY_DRY_RUN:-0}"
GITHUB_NOTIFY="${DEPLOY_GITHUB_NOTIFY:-1}"
GITHUB_ENVIRONMENT="${DEPLOY_GITHUB_ENVIRONMENT:-production}"
GITHUB_DEPLOYMENT_ID=""

log() {
  printf '[deploy] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[deploy] comando ausente: %s\n' "$1" >&2
    exit 1
  fi
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  printf '[deploy] precisa de root/sudo para executar: %s\n' "$*" >&2
  exit 1
}

require_cmd node
require_cmd rsync
require_cmd nginx
require_cmd systemctl

if [ ! -d "$SOURCE_DIR" ]; then
  printf '[deploy] pasta de origem não encontrada: %s\n' "$SOURCE_DIR" >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d /tmp/omnizap-deploy.XXXXXX)"

github_deploy_start() {
  if [ "$DRY_RUN" = "1" ] || [ "$GITHUB_NOTIFY" != "1" ]; then
    return 0
  fi

  local deployment_id=""
  deployment_id="$(
    node "$PROJECT_ROOT/scripts/github-deploy-notify.mjs" start \
      --build-id "$BUILD_ID" \
      --environment "$GITHUB_ENVIRONMENT" \
      --environment-url "$VERIFY_URL" \
      --log-url "$VERIFY_URL" 2>/dev/null || true
  )"
  deployment_id="$(printf '%s' "$deployment_id" | tr -d '[:space:]')"

  if [ -n "$deployment_id" ]; then
    GITHUB_DEPLOYMENT_ID="$deployment_id"
    log "GitHub deployment iniciado: id=$GITHUB_DEPLOYMENT_ID"
  else
    log "GitHub deployment não iniciado (token/repo ausente ou API indisponível)."
  fi
}

github_deploy_status() {
  local state="$1"
  if [ -z "$GITHUB_DEPLOYMENT_ID" ] || [ "$GITHUB_NOTIFY" != "1" ]; then
    return 0
  fi

  if node "$PROJECT_ROOT/scripts/github-deploy-notify.mjs" status \
    --deployment-id "$GITHUB_DEPLOYMENT_ID" \
    --state "$state" \
    --build-id "$BUILD_ID" \
    --environment "$GITHUB_ENVIRONMENT" \
    --environment-url "$VERIFY_URL" \
    --log-url "$VERIFY_URL" >/dev/null 2>&1; then
    log "GitHub deployment atualizado: id=$GITHUB_DEPLOYMENT_ID state=$state"
  else
    log "Aviso: falha ao atualizar status do deployment no GitHub (state=$state)."
  fi
}

finalize() {
  local exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    github_deploy_status "success"
  else
    github_deploy_status "failure"
  fi
  rm -rf "$STAGING_DIR"
}
trap finalize EXIT

log "build_id=$BUILD_ID"
log "Preparando staging em $STAGING_DIR"
rsync -a --delete "$SOURCE_DIR"/ "$STAGING_DIR"/
node "$PROJECT_ROOT/scripts/cache-bust.mjs" --dir "$STAGING_DIR" --version "$BUILD_ID"

if [ "$BACKUP_ENABLED" = "1" ] && [ "$DRY_RUN" != "1" ] && [ -d "$DEPLOY_DIR" ]; then
  BACKUP_STAMP="$(date -u +%Y%m%d-%H%M%S)"
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_STAMP"
  log "Criando backup em $BACKUP_PATH"
  as_root mkdir -p "$BACKUP_PATH"
  as_root rsync -a --delete --exclude '.backup/' "$DEPLOY_DIR"/ "$BACKUP_PATH"/
fi

if [ ! -d "$DEPLOY_DIR" ]; then
  log "Criando diretório de deploy $DEPLOY_DIR"
  as_root mkdir -p "$DEPLOY_DIR"
fi

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 ativo. Simulando sync para $DEPLOY_DIR"
  as_root rsync -avhn --delete --exclude '.backup/' "$STAGING_DIR"/ "$DEPLOY_DIR"/
  log "Dry-run finalizado."
  exit 0
fi

github_deploy_start

log "Sincronizando arquivos para $DEPLOY_DIR"
as_root rsync -a --delete --exclude '.backup/' "$STAGING_DIR"/ "$DEPLOY_DIR"/

log "Validando configuração do nginx"
as_root nginx -t

log "Recarregando serviço $NGINX_SERVICE"
as_root systemctl reload "$NGINX_SERVICE"
as_root systemctl is-active --quiet "$NGINX_SERVICE"

if [ "$RESTART_PM2" = "1" ] && command -v pm2 >/dev/null 2>&1; then
  if as_root pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    log "Reiniciando PM2 app $PM2_APP_NAME"
    as_root pm2 restart "$PM2_APP_NAME" --update-env >/dev/null
  else
    log "PM2 app '$PM2_APP_NAME' não encontrada. Restart ignorado."
  fi
fi

if [ -f "$DEPLOY_DIR/index.html" ]; then
  if command -v rg >/dev/null 2>&1; then
    DEPLOYED_REF="$(rg -o '/js/apps/homeApp.js\\?v=[^"]+' "$DEPLOY_DIR/index.html" -m 1 || true)"
  else
    DEPLOYED_REF="$(grep -oE '/js/apps/homeApp\\.js\\?v=[^"]+' "$DEPLOY_DIR/index.html" | head -n 1 || true)"
  fi
  if [ -n "$DEPLOYED_REF" ]; then
    log "Cache-bust aplicado: $DEPLOYED_REF"
  fi
fi

if command -v curl >/dev/null 2>&1; then
  if curl -kfsS "$VERIFY_URL" >/dev/null; then
    log "Health check OK em $VERIFY_URL"
  else
    log "Health check falhou em $VERIFY_URL (deploy concluído, verifique manualmente)."
  fi
fi

log "Deploy concluído com sucesso."
