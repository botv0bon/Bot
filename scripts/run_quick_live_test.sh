#!/usr/bin/env bash
# Quick runner: copy .env.example -> .env, fill keys, then run this script to execute a small live test
set -euo pipefail
export DOTENV_FILE=".env"
if [ -f "$DOTENV_FILE" ]; then
  # load env vars
  set -a
  . "$DOTENV_FILE"
  set +a
else
  echo "No .env found. Copy .env.example -> .env and fill keys first." >&2
  exit 1
fi

echo "Running quick live test with CAND_LIMIT=${CAND_LIMIT:-30}"
# run integrated fast discovery from src/fastTokenFetcher
npx ts-node -T -e "(async ()=>{ const ff = require('./src/fastTokenFetcher'); if(!ff || typeof ff.runFastDiscoveryCli!=='function'){ console.error('runFastDiscoveryCli not available'); process.exit(2);} await ff.runFastDiscoveryCli({ topN: Number(process.env.CAND_LIMIT||10), timeoutMs: 3000, concurrency: 3 }); process.exit(0); })().catch(e=>{ console.error(e); process.exit(3); })"
