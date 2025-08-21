#!/usr/bin/env bash
set -euo pipefail
# Load env if present
if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
fi
DEX_URL="${DEXSCREENER_API_ENDPOINT:-https://api.dexscreener.com/token-boosts/latest/v1}"
echo "Fetching DexScreener: $DEX_URL"
raw=$(curl -s "$DEX_URL" || true)
if [ -z "$raw" ]; then
  echo "DexScreener returned empty response"
  exit 0
fi
# Extract probable base58 mints
mints=$(printf "%s" "$raw" | grep -oE "[1-9A-HJ-NP-Za-km-z]{32,44}" | uniq | head -n 50)
echo "Candidate mints found: $(printf "%s" "$mints" | wc -w)"
now=$(date +%s)
printed=0
for mint in $mints; do
  if [ "$printed" -ge 10 ]; then
    break
  fi
  payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["%s",{"limit":3}]}' "$mint")
  res=$(curl -sS -X POST "${HELIUS_RPC_URL}" -H "Content-Type: application/json" -d "$payload" 2>/dev/null || true)
  bt=$(printf "%s" "$res" | jq -r '.result[0].blockTime // .[0].blockTime // .result[0].block_time // .[0].block_time // empty' 2>/dev/null || true)
  if [ -z "$bt" ]; then
    continue
  fi
  age=$((now - bt))
  mins=$((age / 60))
  printf "%s  firstBlockTime=%s  ageSec=%s (~%dm)\n" "$mint" "$bt" "$age" "$mins"
  printed=$((printed + 1))
done
if [ "$printed" -eq 0 ]; then
  echo "No tokens with on-chain blockTime found from DexScreener candidates."
fi
