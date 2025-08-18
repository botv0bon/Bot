#!/usr/bin/env bash
set -euo pipefail

# 5-minute watcher for mint creations (initializeMint and alternative patterns)
# Saves found tokens (age<=30s and Jupiter route for $50) to a TSV file.

RPC=https://api.mainnet-beta.solana.com
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
LIMIT=1000
TIMEOUT=8
DURATION=300
POLL_INTERVAL=2
AGE_THRESHOLD=30
AMOUNT_USD=50
OUTFILE=/workspaces/Bot/tmp/jupiter_init_found_5m.tsv

sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi
lamports_for_amount=$(awk -v p="$sol_price" -v a="$AMOUNT_USD" 'BEGIN{printf "%d", (a / p) * 1e9 }')

echo "Starting 5-minute watcher (DURATION=${DURATION}s) — recording to ${OUTFILE}"
echo "SOL=$sol_price — lamports for \$${AMOUNT_USD} = $lamports_for_amount"

echo -e "MintAddress\tAge(s)\tSwapUsdValue\tRouteCount\tAmountUSD" > "$OUTFILE"

declare -A seen_sigs=()
declare -A seen_mints=()
start_ts=$(date +%s)

while [ $(( $(date +%s) - start_ts )) -lt $DURATION ]; do
  sigs_json=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$TOKEN_PROGRAM\",{\"limit\":$LIMIT}]}" ) || true
  signatures=$(echo "$sigs_json" | jq -r '.result[]?.signature' || true)

  while IFS= read -r sig; do
    [ -z "${sig:-}" ] && continue
    if [ -n "${seen_sigs[$sig]:-}" ]; then
      continue
    fi
    seen_sigs[$sig]=1

    txdata=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"encoding\":\"jsonParsed\"}]}" ) || true
    blocktime=$(echo "$txdata" | jq -r '.result.blockTime // empty' )
    if [ -z "${blocktime:-}" ]; then
      continue
    fi
    age=$(( $(date +%s) - blocktime ))

    # extract candidate mint-like addresses from various instruction patterns
    candidates=$(echo "$txdata" | jq -r '[ .result.transaction.message.instructions[]?, .result.meta.innerInstructions[]?.instructions[]? ] | flatten | map(.parsed?.info? // {}) | map(.mint // .account // .newAccount // .destination // .authority // empty) | map(select(. != null and . != "")) | unique | .[]' 2>/dev/null || true)
    if [ -z "${candidates:-}" ]; then
      continue
    fi

    while IFS= read -r mint; do
      [ -z "${mint:-}" ] && continue
      if [ -n "${seen_mints[$mint]:-}" ]; then
        continue
      fi

      # query Jupiter for liquidity for AMOUNT_USD
      quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_amount}&slippage=1"
      quote_raw=$(curl -s --max-time $TIMEOUT "$quote_url" || echo '')
      if echo "$quote_raw" | jq -e . >/dev/null 2>&1; then
        has_route=$(echo "$quote_raw" | jq -r 'if (.routePlan? | length > 0) or (.data? | length > 0) then "true" else "false" end' 2>/dev/null || echo "false")
        swapUsd=$(echo "$quote_raw" | jq -r '.swapUsdValue // empty' 2>/dev/null || echo '')
        route_count=$(echo "$quote_raw" | jq -r '(.routePlan? | length) // 0' 2>/dev/null || echo 0)
      else
        has_route="false"
        swapUsd=""
        route_count=0
      fi

      # accept if age <= AGE_THRESHOLD and has route
      if [ "$has_route" = "true" ] && [ "$age" -le "$AGE_THRESHOLD" ]; then
        seen_mints[$mint]=1
        echo -e "${mint}\t${age}\t${swapUsd}\t${route_count}\t${AMOUNT_USD}" | tee -a "$OUTFILE"
      fi

    done <<< "$candidates"

  done <<< "$signatures"

  sleep $POLL_INTERVAL
done

echo "Done — results saved to ${OUTFILE}"
