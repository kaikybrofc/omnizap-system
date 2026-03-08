#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${CODEQL_CONFIG_FILE:-$ROOT_DIR/.github/codeql/codeql-config.yml}"
LANGUAGES="${CODEQL_LANGUAGES:-javascript-typescript}"
THREADS="${CODEQL_THREADS:-1}"
RAM_MB="${CODEQL_RAM_MB:-6144}"
QUERY_SUITE="${CODEQL_QUERY_SUITE:-codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_DIR="${CODEQL_DB_DIR:-$ROOT_DIR/.tmp_tools/codeql-db-js-$TIMESTAMP}"
SARIF_OUT="${CODEQL_SARIF_OUT:-$ROOT_DIR/.tmp_tools/codeql-js-$TIMESTAMP.sarif}"

resolve_codeql_bin() {
  if command -v codeql >/dev/null 2>&1; then
    command -v codeql
    return
  fi

  if [[ -x "$ROOT_DIR/.tmp_tools/codeql/codeql" ]]; then
    echo "$ROOT_DIR/.tmp_tools/codeql/codeql"
    return
  fi

  echo ""
}

CODEQL_BIN="$(resolve_codeql_bin)"
if [[ -z "$CODEQL_BIN" ]]; then
  echo "CodeQL CLI nao encontrado. Instale o binario 'codeql' no PATH ou em .tmp_tools/codeql/codeql." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Arquivo de configuracao nao encontrado: $CONFIG_FILE" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/.tmp_tools"

echo "CodeQL bin: $CODEQL_BIN"
echo "Config: $CONFIG_FILE"
echo "Languages: $LANGUAGES"
echo "Query suite: $QUERY_SUITE"
echo "Threads: $THREADS"
echo "RAM MB: $RAM_MB"
echo "Database: $DB_DIR"
echo "SARIF: $SARIF_OUT"

if [[ "$QUERY_SUITE" == codeql/javascript-queries:* ]]; then
  "$CODEQL_BIN" pack download codeql/javascript-queries >/dev/null
  "$CODEQL_BIN" pack download codeql/javascript-all >/dev/null
fi

"$CODEQL_BIN" database create "$DB_DIR" \
  --language="$LANGUAGES" \
  --source-root="$ROOT_DIR" \
  --codescanning-config="$CONFIG_FILE"

"$CODEQL_BIN" database analyze "$DB_DIR" "$QUERY_SUITE" \
  --format=sarif-latest \
  --output="$SARIF_OUT" \
  --threads="$THREADS" \
  --ram="$RAM_MB"

echo "Analise concluida: $SARIF_OUT"
