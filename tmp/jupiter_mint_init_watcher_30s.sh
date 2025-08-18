#!/usr/bin/env bash
set -euo pipefail

# Watch for initializeMint instructions (token mint creations) for DURATION seconds
# For each detected mint, query Jupiter for liquidity (amount = $200) and print results.

RPC=https://api.mainnet-beta.solana.com
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
LIMIT=1000
TIMEOUT=8
DURATION=30
POLL_INTERVAL=2

# compute lamports for $200
sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi
lamports_for_200=$(awk -v p="$sol_price" 'BEGIN{printf "%d", (200.0 / p) * 1e9 }')

echo "Watching for initializeMint for ${DURATION}s (LIMIT=${LIMIT}, poll=${POLL_INTERVAL}s)"
echo "SOL=$sol_price — lamports for \$200 = $lamports_for_200"

echo -e "MintAddress\tAge(s)\tJupiterRoute\tSwapUsdValue\tJupiterQuoteSummary"

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

    # extract mints from initializeMint instructions (outer and inner)
    init_mints=$(echo "$txdata" | jq -r --arg tp "$TOKEN_PROGRAM" '[.result.transaction.message.instructions[]? , .result.meta.innerInstructions[]?.instructions[]?] | flatten | map(select(.programId==$tp and (.parsed?.type=="initializeMint"))) | map((.parsed?.info?.mint // .accounts[0])) | unique | .[]' 2>/dev/null || true)
    if [ -z "${init_mints:-}" ]; then
      continue
    fi

    while IFS= read -r mint; do
      [ -z "${mint:-}" ] && continue
      if [ -n "${seen_mints[$mint]:-}" ]; then
        continue
      fi

      # query Jupiter for liquidity
      quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_200}&slippage=1"
      quote_raw=$(curl -s --max-time $TIMEOUT "$quote_url" || echo '')
      if echo "$quote_raw" | jq -e . >/dev/null 2>&1; then
        has_route=$(echo "$quote_raw" | jq -r 'if (.routePlan? | length > 0) or (.data? | length > 0) then "true" else "false" end' 2>/dev/null || echo "false")
        swapUsd=$(echo "$quote_raw" | jq -r '.swapUsdValue // empty' 2>/dev/null || echo '')
        route_count=$(echo "$quote_raw" | jq -r '(.routePlan? | length) // 0' 2>/dev/null || echo 0)
        jq_summary="{\"swapUsd\":\"${swapUsd}\",\"routeCount\":${route_count}}"
      else
        has_route="false"
        jq_summary=""
        swapUsd=""
      fi

      if [ "$has_route" = "true" ] && [ "$age" -le 30 ]; then
        seen_mints[$mint]=1
        echo -e "${mint}\t${age}\tYES\t${swapUsd}\t${jq_summary}"
      fi

    done <<< "$init_mints"

  done <<< "$signatures"

  sleep $POLL_INTERVAL
done

echo
echo "Watching finished (duration=${DURATION}s)."
