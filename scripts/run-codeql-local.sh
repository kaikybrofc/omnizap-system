#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${CODEQL_CONFIG_FILE:-$ROOT_DIR/.github/codeql/codeql-config.yml}"
LANGUAGES="${CODEQL_LANGUAGES:-javascript-typescript}"
QUERY_SUITE="${CODEQL_QUERY_SUITE:-codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_DIR="${CODEQL_DB_DIR:-$ROOT_DIR/.tmp_tools/codeql-db-js-$TIMESTAMP}"
SARIF_OUT="${CODEQL_SARIF_OUT:-$ROOT_DIR/.tmp_tools/codeql-js-$TIMESTAMP.sarif}"
DRY_RUN="${CODEQL_DRY_RUN:-0}"

detect_cpu_threads() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return
  fi

  getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1
}

detect_ram_mb() {
  if [[ -r /proc/meminfo ]]; then
    awk '/MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo
    return
  fi

  free -m 2>/dev/null | awk '/^Mem:/ { print $2 }'
}

TOTAL_CPU_THREADS="$(detect_cpu_threads)"
TOTAL_RAM_MB="$(detect_ram_mb)"

if [[ -z "$TOTAL_CPU_THREADS" || "$TOTAL_CPU_THREADS" -lt 1 ]]; then
  TOTAL_CPU_THREADS=1
fi

if [[ -z "$TOTAL_RAM_MB" || "$TOTAL_RAM_MB" -lt 2048 ]]; then
  TOTAL_RAM_MB=2048
fi

DEFAULT_THREADS=$((TOTAL_CPU_THREADS / 2))
if [[ "$DEFAULT_THREADS" -lt 1 ]]; then
  DEFAULT_THREADS=1
fi

DEFAULT_RAM_MB=$((TOTAL_RAM_MB / 2))
if [[ "$DEFAULT_RAM_MB" -lt 2048 ]]; then
  DEFAULT_RAM_MB=2048
fi

THREADS="${CODEQL_THREADS:-$DEFAULT_THREADS}"
RAM_MB="${CODEQL_RAM_MB:-$DEFAULT_RAM_MB}"

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
echo "Host CPU threads: $TOTAL_CPU_THREADS"
echo "Host RAM MB: $TOTAL_RAM_MB"
echo "Default (50%) threads: $DEFAULT_THREADS"
echo "Default (50%) RAM MB: $DEFAULT_RAM_MB"
echo "Threads: $THREADS"
echo "RAM MB: $RAM_MB"
echo "Database: $DB_DIR"
echo "SARIF: $SARIF_OUT"

if [[ "$DRY_RUN" == "1" || "$DRY_RUN" == "true" ]]; then
  echo "Dry run habilitado. Encerrando sem criar database/analisar."
  exit 0
fi

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
