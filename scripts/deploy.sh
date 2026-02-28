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
PACKAGE_STEP="${DEPLOY_PACKAGE_STEP:-0}"
PACKAGE_INSTALL="${DEPLOY_PACKAGE_INSTALL:-1}"
PACKAGE_TEST="${DEPLOY_PACKAGE_TEST:-0}"
PACKAGE_PACK="${DEPLOY_PACKAGE_PACK:-0}"
PACKAGE_ARTIFACTS_DIR="${DEPLOY_PACKAGE_ARTIFACTS_DIR:-$PROJECT_ROOT/.artifacts}"
PACKAGE_PUBLISH="${DEPLOY_PACKAGE_PUBLISH:-0}"
PACKAGE_PUBLISH_SKIP_IF_EXISTS="${DEPLOY_PACKAGE_PUBLISH_SKIP_IF_EXISTS:-1}"
PACKAGE_REGISTRY="${DEPLOY_PACKAGE_REGISTRY:-https://npm.pkg.github.com}"
PACKAGE_TAG="${DEPLOY_PACKAGE_TAG:-latest}"
PACKAGE_TOKEN="${DEPLOY_PACKAGE_TOKEN:-}"
PACKAGE_PUBLISH_SECONDARY="${DEPLOY_PACKAGE_PUBLISH_SECONDARY:-0}"
PACKAGE_SECONDARY_REGISTRY="${DEPLOY_PACKAGE_SECONDARY_REGISTRY:-https://registry.npmjs.org}"
PACKAGE_SECONDARY_TAG="${DEPLOY_PACKAGE_SECONDARY_TAG:-latest}"
PACKAGE_SECONDARY_TOKEN="${DEPLOY_PACKAGE_SECONDARY_TOKEN:-}"
PACKAGE_SECONDARY_ACCESS="${DEPLOY_PACKAGE_SECONDARY_ACCESS:-public}"
PACKAGE_SECONDARY_PUBLISH_SKIP_IF_EXISTS="${DEPLOY_PACKAGE_SECONDARY_PUBLISH_SKIP_IF_EXISTS:-$PACKAGE_PUBLISH_SKIP_IF_EXISTS}"
PACKAGE_SECONDARY_TOKEN_KEYS="${DEPLOY_PACKAGE_SECONDARY_TOKEN_KEYS:-}"
NPMRC_TMP_FILES=()

log() {
  printf '[deploy] %s\n' "$*"
}

resolve_github_repo() {
  local explicit_repo="${DEPLOY_GITHUB_REPO:-${GITHUB_REPOSITORY:-}}"
  if [ -n "$explicit_repo" ] && printf '%s' "$explicit_repo" | grep -q '/'; then
    printf '%s' "$explicit_repo"
    return 0
  fi

  local remote_url=""
  remote_url="$(cd "$PROJECT_ROOT" && git config --get remote.origin.url 2>/dev/null || true)"
  if [ -z "$remote_url" ]; then
    return 0
  fi

  local repo=""
  repo="$(printf '%s' "$remote_url" | sed -nE 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#p' | head -n 1)"
  if [ -n "$repo" ]; then
    printf '%s' "$repo"
  fi
}

resolve_github_owner() {
  local repo=""
  repo="$(resolve_github_repo)"
  if [ -z "$repo" ]; then
    return 0
  fi
  printf '%s' "$repo" | cut -d'/' -f1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[deploy] comando ausente: %s\n' "$1" >&2
    exit 1
  fi
}

resolve_token_from_dotenv() {
  local token_keys="$1"
  if [ -z "$token_keys" ]; then
    return 0
  fi

  (
    cd "$PROJECT_ROOT" && TOKEN_KEYS="$token_keys" node --input-type=module -e "
      import dotenv from 'dotenv';
      dotenv.config({ path: '.env' });
      const keys = String(process.env.TOKEN_KEYS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      for (const key of keys) {
        const value = process.env[key];
        if (value && String(value).trim()) {
          process.stdout.write(String(value).trim());
          process.exit(0);
        }
      }
    " 2>/dev/null || true
  )
}

default_token_keys_for_registry() {
  local registry="$1"
  if printf '%s' "$registry" | grep -q 'npm.pkg.github.com'; then
    printf 'DEPLOY_PACKAGE_TOKEN,DEPLOY_GITHUB_TOKEN,GITHUB_TOKEN,GH_TOKEN,NPM_TOKEN,NODE_AUTH_TOKEN'
  else
    printf 'DEPLOY_PACKAGE_SECONDARY_TOKEN,NPM_TOKEN,NODE_AUTH_TOKEN,DEPLOY_PACKAGE_TOKEN,DEPLOY_GITHUB_TOKEN,GITHUB_TOKEN,GH_TOKEN'
  fi
}

create_npmrc_for_registry() {
  local registry="$1"
  local token="$2"
  local scope_owner="$3"
  local registry_host=""
  registry_host="$(printf '%s' "$registry" | sed -E 's#^https?://##; s#/*$##')"

  local npmrc_tmp=""
  npmrc_tmp="$(mktemp /tmp/omnizap-npmrc.XXXXXX)"
  {
    printf 'registry=%s\n' "$registry"
    if [ -n "$scope_owner" ]; then
      printf '@%s:registry=%s\n' "$scope_owner" "$registry"
    fi
    printf '//%s/:_authToken=%s\n' "$registry_host" "$token"
    printf '//%s:_authToken=%s\n' "$registry_host" "$token"
  } > "$npmrc_tmp"
  chmod 600 "$npmrc_tmp"
  NPMRC_TMP_FILES+=("$npmrc_tmp")
  printf '%s' "$npmrc_tmp"
}

publish_package_to_registry() {
  local pkg_name="$1"
  local pkg_version="$2"
  local registry="$3"
  local tag="$4"
  local explicit_token="$5"
  local skip_if_exists="$6"
  local access="$7"
  local token_keys_override="$8"

  local token="$explicit_token"
  if [ -z "$token" ]; then
    local token_keys="$token_keys_override"
    if [ -z "$token_keys" ]; then
      token_keys="$(default_token_keys_for_registry "$registry")"
    fi
    token="$(resolve_token_from_dotenv "$token_keys")"
  fi

  if [ -z "$token" ]; then
    printf '[deploy] Publish habilitado para %s, mas nenhum token foi encontrado.\n' "$registry" >&2
    exit 1
  fi

  local scope_owner=""
  scope_owner="$(printf '%s' "$pkg_name" | sed -nE 's#^@([^/]+)/.*#\1#p')"
  local pkg_base_name=""
  pkg_base_name="$(printf '%s' "$pkg_name" | sed -E 's#^@[^/]+/##')"

  if printf '%s' "$registry" | grep -q 'npm.pkg.github.com'; then
    if ! printf '%s' "$pkg_name" | grep -q '^@'; then
      printf '[deploy] Para GitHub Packages o nome do pacote deve ser escopado (ex: @owner/repo).\n' >&2
      exit 1
    fi

    local expected_owner="${DEPLOY_PACKAGE_SCOPE_OWNER:-}"
    if [ -z "$expected_owner" ]; then
      expected_owner="$(resolve_github_owner)"
    fi

    if [ -n "$expected_owner" ] && [ -n "$scope_owner" ] && [ "$scope_owner" != "$expected_owner" ]; then
      printf '[deploy] Scope do pacote (%s) difere do owner GitHub esperado (%s).\n' "$scope_owner" "$expected_owner" >&2
      printf '[deploy] Ajuste com: npm pkg set name=\"@%s/%s\"\n' "$expected_owner" "$pkg_base_name" >&2
      printf '[deploy] Ou defina DEPLOY_PACKAGE_SCOPE_OWNER para publicar em outro owner.\n' >&2
      exit 1
    fi
  fi

  local npmrc_tmp=""
  npmrc_tmp="$(create_npmrc_for_registry "$registry" "$token" "$scope_owner")"

  if ! (
    cd "$PROJECT_ROOT" &&
    npm_config_userconfig="$npmrc_tmp" npm whoami --registry "$registry" --userconfig "$npmrc_tmp" >/dev/null 2>&1
  ); then
    printf '[deploy] Falha de autenticação no registry %s. Verifique token/permissões.\n' "$registry" >&2
    exit 1
  fi

  if [ "$skip_if_exists" = "1" ]; then
    if (
      cd "$PROJECT_ROOT" &&
      npm_config_userconfig="$npmrc_tmp" npm view "${pkg_name}@${pkg_version}" --registry "$registry" --userconfig "$npmrc_tmp" >/dev/null 2>&1
    ); then
      log "Pacote ${pkg_name}@${pkg_version} já publicado em $registry (skip)."
      return 0
    fi
  fi

  log "Publicando ${pkg_name}@${pkg_version} em $registry (tag=$tag)"
  if [ -n "$access" ] && printf '%s' "$registry" | grep -q 'registry.npmjs.org' && printf '%s' "$pkg_name" | grep -q '^@'; then
    (
      cd "$PROJECT_ROOT" &&
      npm_config_userconfig="$npmrc_tmp" npm publish --registry "$registry" --tag "$tag" --access "$access" --userconfig "$npmrc_tmp"
    )
  else
    (
      cd "$PROJECT_ROOT" &&
      npm_config_userconfig="$npmrc_tmp" npm publish --registry "$registry" --tag "$tag" --userconfig "$npmrc_tmp"
    )
  fi
  log "Publish concluído para ${pkg_name}@${pkg_version} em $registry."
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

run_package_stage() {
  if [ "$DRY_RUN" = "1" ] || [ "$PACKAGE_STEP" != "1" ]; then
    return 0
  fi

  require_cmd npm

  local pkg_version="n/d"
  pkg_version="$(cd "$PROJECT_ROOT" && npm pkg get version 2>/dev/null | tr -d '"[:space:]' || true)"
  log "Etapa package iniciada (versão=$pkg_version)."

  if [ "$PACKAGE_INSTALL" = "1" ]; then
    if [ -f "$PROJECT_ROOT/package-lock.json" ]; then
      log "Instalando dependências com npm ci --omit=dev"
      (cd "$PROJECT_ROOT" && npm ci --omit=dev)
    else
      log "Instalando dependências com npm install --omit=dev"
      (cd "$PROJECT_ROOT" && npm install --omit=dev)
    fi
  fi

  if [ "$PACKAGE_TEST" = "1" ]; then
    log "Executando testes de package (npm test)"
    (cd "$PROJECT_ROOT" && npm test)
  fi

  if [ "$PACKAGE_PACK" = "1" ]; then
    log "Gerando artefato npm pack"
    mkdir -p "$PACKAGE_ARTIFACTS_DIR"
    local pack_name=""
    pack_name="$(cd "$PROJECT_ROOT" && npm pack --silent)"
    if [ -n "$pack_name" ] && [ -f "$PROJECT_ROOT/$pack_name" ]; then
      mv "$PROJECT_ROOT/$pack_name" "$PACKAGE_ARTIFACTS_DIR/$pack_name"
      log "Artefato salvo em $PACKAGE_ARTIFACTS_DIR/$pack_name"
    fi
  fi

  if [ "$PACKAGE_PUBLISH" = "1" ] || [ "$PACKAGE_PUBLISH_SECONDARY" = "1" ]; then
    local pkg_name=""
    pkg_name="$(cd "$PROJECT_ROOT" && npm pkg get name 2>/dev/null | tr -d '"[:space:]' || true)"
    if [ -z "$pkg_name" ] || [ -z "$pkg_version" ] || [ "$pkg_version" = "n/d" ]; then
      printf '[deploy] não foi possível ler nome/versão do package para publish.\n' >&2
      exit 1
    fi

    if [ "$PACKAGE_PUBLISH" = "1" ]; then
      publish_package_to_registry \
        "$pkg_name" \
        "$pkg_version" \
        "$PACKAGE_REGISTRY" \
        "$PACKAGE_TAG" \
        "$PACKAGE_TOKEN" \
        "$PACKAGE_PUBLISH_SKIP_IF_EXISTS" \
        "" \
        ""
    fi

    if [ "$PACKAGE_PUBLISH_SECONDARY" = "1" ]; then
      if [ "$PACKAGE_PUBLISH" = "1" ] && [ "$PACKAGE_SECONDARY_REGISTRY" = "$PACKAGE_REGISTRY" ] && [ "$PACKAGE_SECONDARY_TAG" = "$PACKAGE_TAG" ]; then
        log "Registry/tag secundário igual ao primário. Publish secundário ignorado."
      else
        publish_package_to_registry \
          "$pkg_name" \
          "$pkg_version" \
          "$PACKAGE_SECONDARY_REGISTRY" \
          "$PACKAGE_SECONDARY_TAG" \
          "$PACKAGE_SECONDARY_TOKEN" \
          "$PACKAGE_SECONDARY_PUBLISH_SKIP_IF_EXISTS" \
          "$PACKAGE_SECONDARY_ACCESS" \
          "$PACKAGE_SECONDARY_TOKEN_KEYS"
      fi
    fi
  fi

  log "Etapa package concluída."
}

finalize() {
  local exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    github_deploy_status "success"
  else
    github_deploy_status "failure"
  fi
  for npmrc_tmp in "${NPMRC_TMP_FILES[@]:-}"; do
    if [ -n "$npmrc_tmp" ] && [ -f "$npmrc_tmp" ]; then
      rm -f "$npmrc_tmp"
    fi
  done
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
run_package_stage

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
