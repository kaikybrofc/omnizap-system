#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_TYPE="${RELEASE_TYPE:-patch}"
RELEASE_FORCE_VERSION="${RELEASE_FORCE_VERSION:-}"
RELEASE_PATCH_ROLLOVER_ENABLED="${RELEASE_PATCH_ROLLOVER_ENABLED:-1}"
RELEASE_PATCH_ROLLOVER_AT="${RELEASE_PATCH_ROLLOVER_AT:-10}"
RELEASE_GIT_AUTO_COMMIT="${RELEASE_GIT_AUTO_COMMIT:-1}"
RELEASE_GIT_AUTO_PUSH="${RELEASE_GIT_AUTO_PUSH:-1}"
RELEASE_GIT_REMOTE="${RELEASE_GIT_REMOTE:-origin}"
RELEASE_GIT_BRANCH="${RELEASE_GIT_BRANCH:-}"
RELEASE_GIT_PRE_COMMIT_MESSAGE="${RELEASE_GIT_PRE_COMMIT_MESSAGE:-chore(release): auto-commit before release}"
RELEASE_GIT_COMMIT_VERSION="${RELEASE_GIT_COMMIT_VERSION:-1}"
RELEASE_GIT_VERSION_COMMIT_PREFIX="${RELEASE_GIT_VERSION_COMMIT_PREFIX:-chore(release): v}"
RELEASE_GITHUB_RELEASE="${RELEASE_GITHUB_RELEASE:-1}"
RELEASE_REQUIRE_GITHUB_RELEASE="${RELEASE_REQUIRE_GITHUB_RELEASE:-1}"
RELEASE_GITHUB_TAG_PREFIX="${RELEASE_GITHUB_TAG_PREFIX:-v}"
RELEASE_GITHUB_NAME_PREFIX="${RELEASE_GITHUB_NAME_PREFIX:-v}"
RELEASE_GITHUB_GENERATE_NOTES="${RELEASE_GITHUB_GENERATE_NOTES:-1}"
RELEASE_GITHUB_PRERELEASE="${RELEASE_GITHUB_PRERELEASE:-}"
RELEASE_GITHUB_DRAFT="${RELEASE_GITHUB_DRAFT:-0}"
RELEASE_GITHUB_TARGET="${RELEASE_GITHUB_TARGET:-}"
RELEASE_REQUIRE_DUAL_PUBLISH="${RELEASE_REQUIRE_DUAL_PUBLISH:-1}"
RELEASE_VERIFY_UNIFIED_VERSION="${RELEASE_VERIFY_UNIFIED_VERSION:-1}"
RELEASE_VERIFY_PRIMARY_REGISTRY="${RELEASE_VERIFY_PRIMARY_REGISTRY:-${DEPLOY_PACKAGE_REGISTRY:-https://npm.pkg.github.com}}"
RELEASE_VERIFY_SECONDARY_REGISTRY="${RELEASE_VERIFY_SECONDARY_REGISTRY:-${DEPLOY_PACKAGE_SECONDARY_REGISTRY:-https://registry.npmjs.org}}"
RELEASE_VERIFY_PRIMARY_TOKEN_KEYS="${RELEASE_VERIFY_PRIMARY_TOKEN_KEYS:-DEPLOY_PACKAGE_TOKEN,DEPLOY_GITHUB_TOKEN,GITHUB_TOKEN,GH_TOKEN,NPM_TOKEN,NODE_AUTH_TOKEN}"
RELEASE_VERIFY_SECONDARY_TOKEN_KEYS="${RELEASE_VERIFY_SECONDARY_TOKEN_KEYS:-DEPLOY_PACKAGE_SECONDARY_TOKEN,NPM_TOKEN,NODE_AUTH_TOKEN}"
TMP_NPMRC_FILES=()

case "$RELEASE_TYPE" in
  patch|minor|major|prepatch|preminor|premajor|prerelease)
    ;;
  *)
    printf '[release] RELEASE_TYPE inválido: %s\n' "$RELEASE_TYPE" >&2
    printf '[release] Valores permitidos: patch, minor, major, prepatch, preminor, premajor, prerelease\n' >&2
    exit 1
    ;;
esac

log() {
  printf '[release] %s\n' "$*"
}

cleanup_tmp_npmrcs() {
  for npmrc_tmp in "${TMP_NPMRC_FILES[@]:-}"; do
    if [ -n "$npmrc_tmp" ] && [ -f "$npmrc_tmp" ]; then
      rm -f "$npmrc_tmp"
    fi
  done
}
trap cleanup_tmp_npmrcs EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[release] comando ausente: %s\n' "$1" >&2
    exit 1
  fi
}

to_bool() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      printf 'true'
      ;;
    *)
      printf 'false'
      ;;
  esac
}

sanitize_npm_output() {
  printf '%s' "$1" | tr -d "\"'[:space:]"
}

resolve_branch() {
  if [ -n "$RELEASE_GIT_BRANCH" ]; then
    printf '%s' "$RELEASE_GIT_BRANCH"
    return 0
  fi

  local branch=""
  branch="$(cd "$PROJECT_ROOT" && git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ -z "$branch" ]; then
    branch="$(cd "$PROJECT_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  fi
  if [ "$branch" = "HEAD" ]; then
    branch=""
  fi
  printf '%s' "$branch"
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

create_npmrc_for_registry() {
  local registry="$1"
  local token="$2"
  local scope_owner="$3"
  local registry_host=""
  registry_host="$(printf '%s' "$registry" | sed -E 's#^https?://##; s#/*$##')"

  local npmrc_tmp=""
  npmrc_tmp="$(mktemp /tmp/omnizap-release-npmrc.XXXXXX)"
  {
    printf 'registry=%s\n' "$registry"
    if [ -n "$scope_owner" ]; then
      printf '@%s:registry=%s\n' "$scope_owner" "$registry"
    fi
    if [ -n "$token" ]; then
      printf '//%s/:_authToken=%s\n' "$registry_host" "$token"
      printf '//%s:_authToken=%s\n' "$registry_host" "$token"
    fi
  } > "$npmrc_tmp"
  chmod 600 "$npmrc_tmp"
  TMP_NPMRC_FILES+=("$npmrc_tmp")
  printf '%s' "$npmrc_tmp"
}

verify_registry_version() {
  local pkg_name="$1"
  local pkg_version="$2"
  local registry="$3"
  local token_keys="$4"
  local auth_required="$5"

  local token=""
  token="$(resolve_token_from_dotenv "$token_keys")"
  if [ "$auth_required" = "1" ] && [ -z "$token" ]; then
    printf '[release] Verificação em %s requer token (keys: %s).\n' "$registry" "$token_keys" >&2
    exit 1
  fi

  local scope_owner=""
  scope_owner="$(printf '%s' "$pkg_name" | sed -nE 's#^@([^/]+)/.*#\1#p')"
  local npmrc_tmp=""
  npmrc_tmp="$(create_npmrc_for_registry "$registry" "$token" "$scope_owner")"

  local version_raw=""
  if ! version_raw="$(
    cd "$PROJECT_ROOT" &&
    npm_config_userconfig="$npmrc_tmp" npm view "${pkg_name}@${pkg_version}" version --registry "$registry" --userconfig "$npmrc_tmp" 2>/dev/null
  )"; then
    printf '[release] Falha ao validar versão %s em %s.\n' "$pkg_version" "$registry" >&2
    exit 1
  fi
  local version_value=""
  version_value="$(sanitize_npm_output "$version_raw")"
  if [ "$version_value" != "$pkg_version" ]; then
    printf '[release] Versão divergente em %s: esperado=%s encontrado=%s\n' "$registry" "$pkg_version" "${version_value:-vazio}" >&2
    exit 1
  fi

  local latest_raw=""
  if ! latest_raw="$(
    cd "$PROJECT_ROOT" &&
    npm_config_userconfig="$npmrc_tmp" npm view "$pkg_name" dist-tags.latest --registry "$registry" --userconfig "$npmrc_tmp" 2>/dev/null
  )"; then
    printf '[release] Falha ao validar dist-tag latest em %s.\n' "$registry" >&2
    exit 1
  fi
  local latest_value=""
  latest_value="$(sanitize_npm_output "$latest_raw")"
  if [ "$latest_value" != "$pkg_version" ]; then
    printf '[release] Dist-tag latest divergente em %s: esperado=%s latest=%s\n' "$registry" "$pkg_version" "${latest_value:-vazio}" >&2
    exit 1
  fi

  log "Verificado em $registry: versão=$pkg_version latest=$latest_value"
}

compute_target_version() {
  local current="$1"

  if [ -n "$RELEASE_FORCE_VERSION" ]; then
    printf '%s' "$RELEASE_FORCE_VERSION"
    return 0
  fi

  if [ "$RELEASE_TYPE" = "patch" ] && [ "$RELEASE_PATCH_ROLLOVER_ENABLED" = "1" ]; then
    if [[ "$RELEASE_PATCH_ROLLOVER_AT" =~ ^[0-9]+$ ]] && [[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
      local major="${BASH_REMATCH[1]}"
      local minor="${BASH_REMATCH[2]}"
      local patch="${BASH_REMATCH[3]}"
      if [ "$patch" -ge "$RELEASE_PATCH_ROLLOVER_AT" ]; then
        printf '%s.%s.0' "$major" "$((minor + 1))"
        return 0
      fi
    fi
  fi

  printf ''
}

commit_and_push_if_dirty() {
  local commit_message="$1"

  if [ "$RELEASE_GIT_AUTO_COMMIT" != "1" ]; then
    return 0
  fi

  local git_status=""
  git_status="$(cd "$PROJECT_ROOT" && git status --porcelain --untracked-files=normal)"
  if [ -z "$git_status" ]; then
    return 0
  fi

  log "Alterações não commitadas detectadas. Criando commit automático."
  (
    cd "$PROJECT_ROOT"
    git add -A
    if git diff --cached --quiet; then
      exit 0
    fi
    git commit -m "$commit_message" >/dev/null
  )

  if [ "$RELEASE_GIT_AUTO_PUSH" = "1" ]; then
    local branch=""
    branch="$(resolve_branch)"
    if [ -z "$branch" ]; then
      printf '[release] Branch atual indefinida (detached HEAD). Defina RELEASE_GIT_BRANCH para push automático.\n' >&2
      exit 1
    fi
    log "Enviando commit para $RELEASE_GIT_REMOTE/$branch"
    (cd "$PROJECT_ROOT" && git push "$RELEASE_GIT_REMOTE" "$branch")
  fi
}

require_cmd git
require_cmd npm
require_cmd node

if ! (cd "$PROJECT_ROOT" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  printf '[release] este diretório não é um repositório git válido.\n' >&2
  exit 1
fi

if [ "$RELEASE_REQUIRE_GITHUB_RELEASE" = "1" ] && [ "$RELEASE_GITHUB_RELEASE" != "1" ]; then
  printf '[release] RELEASE_REQUIRE_GITHUB_RELEASE=1 exige RELEASE_GITHUB_RELEASE=1.\n' >&2
  exit 1
fi

commit_and_push_if_dirty "$RELEASE_GIT_PRE_COMMIT_MESSAGE"

current_version="$(cd "$PROJECT_ROOT" && npm pkg get version | tr -d '"[:space:]')"
log "Versão atual: $current_version"
target_version="$(compute_target_version "$current_version")"

if [ -n "$target_version" ]; then
  if [ "$target_version" = "$current_version" ]; then
    printf '[release] versão alvo igual à versão atual (%s). Verifique regras de bump.\n' "$current_version" >&2
    exit 1
  fi
  log "Aplicando versão alvo: $target_version"
  (cd "$PROJECT_ROOT" && npm version "$target_version" --no-git-tag-version >/dev/null)
else
  log "Aplicando bump: $RELEASE_TYPE"
  (cd "$PROJECT_ROOT" && npm version "$RELEASE_TYPE" --no-git-tag-version >/dev/null)
fi

new_version="$(cd "$PROJECT_ROOT" && npm pkg get version | tr -d '"[:space:]')"
log "Nova versão: $new_version"

log "Executando deploy com publish de package"
deploy_publish_primary="${DEPLOY_PACKAGE_PUBLISH:-1}"
deploy_publish_secondary="${DEPLOY_PACKAGE_PUBLISH_SECONDARY:-1}"

if [ "$RELEASE_REQUIRE_DUAL_PUBLISH" = "1" ]; then
  if [ "$deploy_publish_primary" != "1" ] || [ "$deploy_publish_secondary" != "1" ]; then
    printf '[release] RELEASE_REQUIRE_DUAL_PUBLISH=1 exige DEPLOY_PACKAGE_PUBLISH=1 e DEPLOY_PACKAGE_PUBLISH_SECONDARY=1.\n' >&2
    exit 1
  fi
fi

if ! (
  cd "$PROJECT_ROOT"
  DEPLOY_PACKAGE_STEP="${DEPLOY_PACKAGE_STEP:-1}" \
  DEPLOY_PACKAGE_PUBLISH="$deploy_publish_primary" \
  DEPLOY_PACKAGE_PUBLISH_SECONDARY="$deploy_publish_secondary" \
  DEPLOY_PACKAGE_SECONDARY_REGISTRY="${DEPLOY_PACKAGE_SECONDARY_REGISTRY:-https://registry.npmjs.org}" \
  DEPLOY_PACKAGE_SECONDARY_ACCESS="${DEPLOY_PACKAGE_SECONDARY_ACCESS:-public}" \
  DEPLOY_PACKAGE_INSTALL="${DEPLOY_PACKAGE_INSTALL:-0}" \
  DEPLOY_PACKAGE_TEST="${DEPLOY_PACKAGE_TEST:-0}" \
  DEPLOY_PACKAGE_PACK="${DEPLOY_PACKAGE_PACK:-1}" \
  npm run deploy
); then
  log "Deploy/release falhou. Revertendo versão para $current_version"
  (cd "$PROJECT_ROOT" && npm version "$current_version" --no-git-tag-version >/dev/null)
  exit 1
fi

if [ "$RELEASE_GIT_COMMIT_VERSION" = "1" ]; then
  commit_and_push_if_dirty "${RELEASE_GIT_VERSION_COMMIT_PREFIX}${new_version}"
fi

release_tag="${RELEASE_GITHUB_TAG_PREFIX}${new_version}"

if [ "$RELEASE_GITHUB_RELEASE" = "1" ]; then
  if [ "$RELEASE_GIT_AUTO_PUSH" != "1" ]; then
    printf '[release] RELEASE_GITHUB_RELEASE=1 requer RELEASE_GIT_AUTO_PUSH=1 para garantir commit acessível no GitHub.\n' >&2
    exit 1
  fi

  local_name="${RELEASE_GITHUB_NAME_PREFIX}${new_version}"
  local_target="$RELEASE_GITHUB_TARGET"
  if [ -z "$local_target" ]; then
    local_target="$(cd "$PROJECT_ROOT" && git rev-parse HEAD)"
  fi

  local_prerelease="$RELEASE_GITHUB_PRERELEASE"
  if [ -z "$local_prerelease" ]; then
    if printf '%s' "$new_version" | grep -q '-'; then
      local_prerelease="1"
    else
      local_prerelease="0"
    fi
  fi

  local generate_notes_bool=""
  generate_notes_bool="$(to_bool "$RELEASE_GITHUB_GENERATE_NOTES")"
  local prerelease_bool=""
  prerelease_bool="$(to_bool "$local_prerelease")"
  local draft_bool=""
  draft_bool="$(to_bool "$RELEASE_GITHUB_DRAFT")"

  log "Criando/atualizando GitHub Release ($release_tag)"
  release_output="$(
    cd "$PROJECT_ROOT" && node ./scripts/github-release-notify.mjs upsert \
      --tag "$release_tag" \
      --target "$local_target" \
      --name "$local_name" \
      --generate-notes "$generate_notes_bool" \
      --prerelease "$prerelease_bool" \
      --draft "$draft_bool"
  )"
  log "GitHub Release atualizado: $release_output"
fi

if [ "$RELEASE_VERIFY_UNIFIED_VERSION" = "1" ]; then
  pkg_name="$(cd "$PROJECT_ROOT" && npm pkg get name | tr -d '"[:space:]')"
  if [ -z "$pkg_name" ]; then
    printf '[release] Falha ao ler nome do pacote para verificação final.\n' >&2
    exit 1
  fi

  local_version_now="$(cd "$PROJECT_ROOT" && npm pkg get version | tr -d '"[:space:]')"
  if [ "$local_version_now" != "$new_version" ]; then
    printf '[release] Versão local divergente após release: esperado=%s encontrado=%s\n' "$new_version" "$local_version_now" >&2
    exit 1
  fi
  log "Verificado localmente: versão=$local_version_now"

  verify_registry_version "$pkg_name" "$new_version" "$RELEASE_VERIFY_PRIMARY_REGISTRY" "$RELEASE_VERIFY_PRIMARY_TOKEN_KEYS" "1"
  verify_registry_version "$pkg_name" "$new_version" "$RELEASE_VERIFY_SECONDARY_REGISTRY" "$RELEASE_VERIFY_SECONDARY_TOKEN_KEYS" "0"

  gh_release_check="$(
    cd "$PROJECT_ROOT" && node ./scripts/github-release-notify.mjs get --tag "$release_tag"
  )"
  log "Verificado GitHub Release: $gh_release_check"
  log "Verificação final concluída: todas as versões estão em $new_version"
fi

log "Release concluída: $new_version"
