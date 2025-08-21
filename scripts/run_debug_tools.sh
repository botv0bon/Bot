#!/usr/bin/env bash
set -euo pipefail
# Lightweight runner for project debug/test utilities. This is opt-in; run manually.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "Debug runner: will attempt to run available test/debug helpers (opt-in)"
echo "Ensure .env contains necessary keys (HELIUS_RPC_URL, HELIUS_API_KEY, HELIUS_USE_WEBSOCKET=true for WS)"

TSNODE_BIN="./node_modules/.bin/ts-node"
if [ ! -x "$TSNODE_BIN" ]; then
  echo "Warning: ts-node not found at $TSNODE_BIN — TypeScript scripts may fail. Install dev deps if needed." 
fi

run_debug_filter(){
  echo "debug_filter.ts removed — no per-user debug filter available."
}

run_age_probe(){
  if [ -f "./scripts/run_age_probe.ts" ]; then
    echo "\n--- Running run_age_probe.ts (on-chain age probes) ---"
    if [ -x "$TSNODE_BIN" ]; then
      "$TSNODE_BIN" --project tsconfig.json scripts/run_age_probe.ts || echo "run_age_probe failed"
    else
      node -r ts-node/register scripts/run_age_probe.ts || echo "run_age_probe failed"
    fi
  fi
}

run_fast_discovery(){
  echo "\n--- Running fastTokenFetcher (latest candidates) ---"
  if [ -x "$TSNODE_BIN" ]; then
    "$TSNODE_BIN" --project tsconfig.json src/fastTokenFetcher.ts latest || echo "fastTokenFetcher failed"
  else
    node -r ts-node/register src/fastTokenFetcher.ts latest || echo "fastTokenFetcher failed"
  fi
}

run_helius_ws(){
  # only run WS if enabled in .env
  if [ "${HELIUS_USE_WEBSOCKET:-false}" = "true" ]; then
    echo "\n--- Starting Helius WebSocket listener (foreground) ---"
    # run in foreground so user can Ctrl-C to stop; user must ensure HELIUS_WS_URL set
    node -r ts-node/register src/heliusWsListener.ts || echo "heliusWsListener failed"
  else
    echo "HELIUS_USE_WEBSOCKET not true — skipping heliusWsListener"
  fi
}

print_help(){
  cat <<'EOF'
Usage: scripts/run_debug_tools.sh [options]

Options:
  --user <userId>   Pass userId to debug_filter.ts (defaults to first user in users.json)
  --age-probe       Run run_age_probe.ts
  --fast            Run fastTokenFetcher latest discovery
  --ws              Start heliusWsListener (requires HELIUS_USE_WEBSOCKET=true)
  --all             Run debug_filter, age probe, and fast discovery (no ws)
  -h, --help        Show this help
EOF
}

USERID=""
DO_AGE=0
DO_FAST=0
DO_WS=0
DO_FILTER=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user) USERID="$2"; shift 2 ;;
    --age-probe) DO_AGE=1; shift ;;
    --fast) DO_FAST=1; shift ;;
    --ws) DO_WS=1; shift ;;
    --all) DO_AGE=1; DO_FAST=1; DO_FILTER=1; shift ;;
    -h|--help) print_help; exit 0 ;;
    *) echo "Unknown arg: $1"; print_help; exit 2 ;;
  esac
done

if [ $DO_FILTER -eq 1 ] || ([ $DO_AGE -eq 0 ] && [ $DO_FAST -eq 0 ] && [ $DO_WS -eq 0 ]); then
  DO_FILTER=1
fi

if [ $DO_FILTER -eq 1 ]; then run_debug_filter "$USERID"; fi
if [ $DO_AGE -eq 1 ]; then run_age_probe; fi
if [ $DO_FAST -eq 1 ]; then run_fast_discovery; fi
if [ $DO_WS -eq 1 ]; then run_helius_ws; fi

echo "\nDebug runner finished."
