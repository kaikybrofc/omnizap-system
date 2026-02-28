#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_TYPE="${RELEASE_TYPE:-patch}"
RELEASE_GIT_AUTO_COMMIT="${RELEASE_GIT_AUTO_COMMIT:-1}"
RELEASE_GIT_AUTO_PUSH="${RELEASE_GIT_AUTO_PUSH:-1}"
RELEASE_GIT_REMOTE="${RELEASE_GIT_REMOTE:-origin}"
RELEASE_GIT_BRANCH="${RELEASE_GIT_BRANCH:-}"
RELEASE_GIT_PRE_COMMIT_MESSAGE="${RELEASE_GIT_PRE_COMMIT_MESSAGE:-chore(release): auto-commit before release}"
RELEASE_GIT_COMMIT_VERSION="${RELEASE_GIT_COMMIT_VERSION:-1}"
RELEASE_GIT_VERSION_COMMIT_PREFIX="${RELEASE_GIT_VERSION_COMMIT_PREFIX:-chore(release): v}"

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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[release] comando ausente: %s\n' "$1" >&2
    exit 1
  fi
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

if ! (cd "$PROJECT_ROOT" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  printf '[release] este diretório não é um repositório git válido.\n' >&2
  exit 1
fi

commit_and_push_if_dirty "$RELEASE_GIT_PRE_COMMIT_MESSAGE"

current_version="$(cd "$PROJECT_ROOT" && npm pkg get version | tr -d '"[:space:]')"
log "Versão atual: $current_version"
log "Aplicando bump: $RELEASE_TYPE"

(cd "$PROJECT_ROOT" && npm version "$RELEASE_TYPE" --no-git-tag-version >/dev/null)

new_version="$(cd "$PROJECT_ROOT" && npm pkg get version | tr -d '"[:space:]')"
log "Nova versão: $new_version"

log "Executando deploy com publish de package"

if ! (
  cd "$PROJECT_ROOT"
  DEPLOY_PACKAGE_STEP="${DEPLOY_PACKAGE_STEP:-1}" \
  DEPLOY_PACKAGE_PUBLISH="${DEPLOY_PACKAGE_PUBLISH:-1}" \
  DEPLOY_PACKAGE_PUBLISH_SECONDARY="${DEPLOY_PACKAGE_PUBLISH_SECONDARY:-1}" \
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

log "Release concluída: $new_version"
