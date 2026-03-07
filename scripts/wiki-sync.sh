#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_SOURCE_DIR="${WIKI_SYNC_SOURCE_DIR:-$PROJECT_ROOT/docs/wiki}"
WIKI_GIT_REMOTE="${WIKI_SYNC_GIT_REMOTE:-}"
WIKI_ORIGIN_REMOTE="${WIKI_SYNC_ORIGIN_REMOTE:-origin}"
WIKI_GIT_BRANCH="${WIKI_SYNC_GIT_BRANCH:-}"
WIKI_TMP_DIR="${WIKI_SYNC_TMP_DIR:-/tmp/omnizap-wiki-sync}"
WIKI_SYNC_DELETE="${WIKI_SYNC_DELETE:-0}"
WIKI_SYNC_PUSH="${WIKI_SYNC_PUSH:-1}"
WIKI_SYNC_KEEP_TMP="${WIKI_SYNC_KEEP_TMP:-0}"
WIKI_SYNC_RELEASE_VERSION="${WIKI_SYNC_RELEASE_VERSION:-}"
WIKI_SYNC_COMMIT_MESSAGE="${WIKI_SYNC_COMMIT_MESSAGE:-docs(wiki): sync from docs/wiki}"
WIKI_SYNC_GITHUB_TOKEN="${WIKI_SYNC_GITHUB_TOKEN:-${RELEASE_GITHUB_TOKEN:-${DEPLOY_GITHUB_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}}}"
WIKI_SYNC_GIT_USER_NAME="${WIKI_SYNC_GIT_USER_NAME:-}"
WIKI_SYNC_GIT_USER_EMAIL="${WIKI_SYNC_GIT_USER_EMAIL:-}"

log() {
  printf '[wiki-sync] %s\n' "$*"
}

is_true() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[wiki-sync] comando ausente: %s\n' "$1" >&2
    exit 1
  fi
}

resolve_repo_from_remote() {
  local remote_name="$1"
  local remote_url=""
  remote_url="$(cd "$PROJECT_ROOT" && git config --get "remote.${remote_name}.url" 2>/dev/null || true)"
  if [ -z "$remote_url" ]; then
    return 0
  fi

  local repo=""
  repo="$(printf '%s' "$remote_url" | sed -nE 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#p' | head -n 1)"
  printf '%s' "$repo"
}

build_wiki_remote() {
  local repo="$1"
  if [ -z "$repo" ]; then
    return 0
  fi
  if [ -n "$WIKI_SYNC_GITHUB_TOKEN" ]; then
    printf 'https://x-access-token:%s@github.com/%s.wiki.git' "$WIKI_SYNC_GITHUB_TOKEN" "$repo"
    return 0
  fi
  printf 'https://github.com/%s.wiki.git' "$repo"
}

resolve_git_identity_field() {
  local key="$1"
  local explicit_value="$2"
  local value=""

  if [ -n "$explicit_value" ]; then
    printf '%s' "$explicit_value"
    return 0
  fi

  value="$(git -C "$PROJECT_ROOT" config --get "$key" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi

  value="$(git config --global --get "$key" 2>/dev/null || true)"
  printf '%s' "$value"
}

configure_wiki_git_identity() {
  local git_user_name=""
  local git_user_email=""

  git_user_name="$(resolve_git_identity_field "user.name" "$WIKI_SYNC_GIT_USER_NAME")"
  git_user_email="$(resolve_git_identity_field "user.email" "$WIKI_SYNC_GIT_USER_EMAIL")"

  if [ -z "$git_user_name" ] && [ -n "${GITHUB_ACTOR:-}" ]; then
    git_user_name="$GITHUB_ACTOR"
  fi
  if [ -z "$git_user_email" ] && [ -n "${GITHUB_ACTOR:-}" ]; then
    git_user_email="${GITHUB_ACTOR}@users.noreply.github.com"
  fi

  if [ -z "$git_user_name" ]; then
    git_user_name="github-actions[bot]"
  fi
  if [ -z "$git_user_email" ]; then
    git_user_email="41898282+github-actions[bot]@users.noreply.github.com"
  fi

  git -C "$WIKI_TMP_DIR" config user.name "$git_user_name"
  git -C "$WIKI_TMP_DIR" config user.email "$git_user_email"
  log "Identidade git configurada para wiki: $git_user_name <$git_user_email>"
}

cleanup_tmp_dir() {
  if is_true "$WIKI_SYNC_KEEP_TMP"; then
    return 0
  fi
  if [ -d "$WIKI_TMP_DIR" ]; then
    rm -rf "$WIKI_TMP_DIR"
  fi
}
trap cleanup_tmp_dir EXIT

require_cmd git
require_cmd rsync

if [ ! -d "$WIKI_SOURCE_DIR" ]; then
  log "Diretório de wiki não encontrado: $WIKI_SOURCE_DIR (skip)."
  exit 0
fi

if [ -z "$(find "$WIKI_SOURCE_DIR" -type f -name '*.md' -print -quit 2>/dev/null)" ]; then
  log "Nenhum arquivo .md em $WIKI_SOURCE_DIR (skip)."
  exit 0
fi

wiki_remote="$WIKI_GIT_REMOTE"
if [ -z "$wiki_remote" ]; then
  repo_slug="$(resolve_repo_from_remote "$WIKI_ORIGIN_REMOTE")"
  if [ -z "$repo_slug" ]; then
    log "Não foi possível resolver owner/repo para wiki (skip)."
    exit 0
  fi
  wiki_remote="$(build_wiki_remote "$repo_slug")"
fi

if [ -z "$wiki_remote" ]; then
  log "Remote da wiki vazio (skip)."
  exit 0
fi

rm -rf "$WIKI_TMP_DIR"
log "Clonando wiki: $wiki_remote"
git clone "$wiki_remote" "$WIKI_TMP_DIR"

sync_args=(-a --exclude '.git')
if is_true "$WIKI_SYNC_DELETE"; then
  sync_args+=(--delete)
fi

log "Sincronizando conteúdo de $WIKI_SOURCE_DIR"
rsync "${sync_args[@]}" "$WIKI_SOURCE_DIR"/ "$WIKI_TMP_DIR"/
configure_wiki_git_identity

git -C "$WIKI_TMP_DIR" add -A
if git -C "$WIKI_TMP_DIR" diff --cached --quiet; then
  log "Nenhuma alteração para publicar na wiki."
  exit 0
fi

commit_message="$WIKI_SYNC_COMMIT_MESSAGE"
if [ -n "$WIKI_SYNC_RELEASE_VERSION" ]; then
  commit_message="${commit_message} (v${WIKI_SYNC_RELEASE_VERSION})"
fi

log "Criando commit na wiki"
git -C "$WIKI_TMP_DIR" commit -m "$commit_message" >/dev/null

if ! is_true "$WIKI_SYNC_PUSH"; then
  log "WIKI_SYNC_PUSH=0, commit local criado sem push."
  exit 0
fi

branch="$WIKI_GIT_BRANCH"
if [ -z "$branch" ]; then
  branch="$(git -C "$WIKI_TMP_DIR" rev-parse --abbrev-ref HEAD)"
fi

log "Enviando wiki para origin/$branch"
git -C "$WIKI_TMP_DIR" push origin "$branch"
log "Wiki sincronizada com sucesso."
