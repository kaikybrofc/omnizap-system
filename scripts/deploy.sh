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
require_cmd rg

if [ ! -d "$SOURCE_DIR" ]; then
  printf '[deploy] pasta de origem não encontrada: %s\n' "$SOURCE_DIR" >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d /tmp/omnizap-deploy.XXXXXX)"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

log "build_id=$BUILD_ID"
log "Preparando staging em $STAGING_DIR"
rsync -a --delete "$SOURCE_DIR"/ "$STAGING_DIR"/
node "$PROJECT_ROOT/scripts/cache-bust.mjs" --dir "$STAGING_DIR" --version "$BUILD_ID"

if [ "$BACKUP_ENABLED" = "1" ] && [ -d "$DEPLOY_DIR" ]; then
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
  DEPLOYED_REF="$(rg -o '/js/apps/homeApp.js\\?v=[^"]+' "$DEPLOY_DIR/index.html" -m 1 || true)"
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
