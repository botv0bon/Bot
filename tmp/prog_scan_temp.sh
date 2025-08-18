#!/usr/bin/env bash
set -euo pipefail

RPC="https://api.mainnet-beta.solana.com"
AMOUNT_USD=50
TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

# fetch SOL price
sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd // ""')
if [ -z "${sol_price}" ] || [ "${sol_price}" = "null" ]; then
  echo "ERROR: cannot fetch SOL price" >&2
  exit 1
fi
# compute lamports using python for safe float math
lamports=$(python3 - <<PY
p=${sol_price}
a=${AMOUNT_USD}
print(int((a / p) * 1e9))
PY
)
printf "Using amount=\$%s (lamports=%s)\n" "$AMOUNT_USD" "$lamports"

LIMITS=(500 1000 2000)
for LIM in "${LIMITS[@]}"; do
  echo
  echo "--- Scanning last $LIM signatures for TOKEN_PROGRAM (amount=\$$AMOUNT_USD) ---"
  sigs_json=$(curl -s --max-time 20 -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$TOKEN_PROGRAM\",{\"limit\":$LIM}]}" ) || true
  sigs=$(echo "$sigs_json" | jq -r '.result[]?.signature' || true)
  if [ -z "${sigs}" ]; then
    echo "No signatures returned for limit $LIM"; continue
  fi
  found=0
  for sig in $sigs; do
    tx_json=$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"encoding\":\"jsonParsed\"}]}" ) || continue
    # extract candidate addresses robustly
    candidates=$(echo "$tx_json" | jq -r '([.result.transaction.message.instructions[]? , .result.meta.innerInstructions[]?.instructions[]?] | flatten | map(.parsed?.info? // {}) | map(.mint // .newAccount // .account // .destination // .authority // empty) | map(select(. != null and . != "")) | unique)[]' 2>/dev/null || true)
    if [ -z "${candidates}" ]; then
      continue
    fi
    while IFS= read -r mint; do
      mint=$(echo "$mint" | tr -d '"')
      [ -z "$mint" ] && continue
      quote=$(curl -s --max-time 8 "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippage=1" || echo '')
      if ! echo "$quote" | jq -e . >/dev/null 2>&1; then
        continue
      fi
      has=$(echo "$quote" | jq -r 'if (.routePlan? | length>0) or (.data? | length>0) then "true" else "false" end' 2>/dev/null || echo 'false')
      if [ "$has" != "true" ]; then
        continue
      fi
      swapUsd=$(echo "$quote" | jq -r '.swapUsdValue // ""' 2>/dev/null || echo '')
      printf "FOUND (limit %s): mint=%s sig=%s swapUsd=%s\n" "$LIM" "$mint" "$sig" "$swapUsd"
      found=1
      break 2
    done <<< "$candidates"
  done
  if [ $found -eq 0 ]; then
    echo "No matches in last $LIM signatures."
  else
    echo "Matches found for limit $LIM — stopping larger scans."
    break
  fi
done
