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
# run with ts-node
npx ts-node -T tmp_check_candidates.ts
