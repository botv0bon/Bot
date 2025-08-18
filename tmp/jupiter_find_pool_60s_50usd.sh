#!/usr/bin/env bash
set -euo pipefail

# بحث أوسع لمدة 60s لايجاد مِنتات عمرها <=30s ولها route في Jupiter
RPC=https://api.mainnet-beta.solana.com
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
LIMIT=1000
TIMEOUT=8
DURATION=60
POLL_INTERVAL=2
AGE_THRESHOLD=30
AMOUNT_USD=50

sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi
lamports_for_amount=$(awk -v p="$sol_price" -v a="$AMOUNT_USD" 'BEGIN{printf "%d", (a / p) * 1e9 }')

echo "تشغيل بحث أوسع لمدة ${DURATION}s — LIMIT=${LIMIT} — AGE_THRESHOLD=${AGE_THRESHOLD}s — AMOUNT_USD=\$${AMOUNT_USD}"
echo "سعر SOL=$sol_price — lamports for \$${AMOUNT_USD} = $lamports_for_amount"

echo -e "MintAddress\tAge(s)\tRoute\tPump\tNotes\tSwapUsdValue\tJupiterQuoteSummary"

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

    mints=$(echo "$txdata" | jq -r '[.result.meta.postTokenBalances[]?.mint, .result.meta.innerInstructions[]?.instructions[]?.parsed?.info?.mint] | map(select(.!=null)) | unique | .[]' 2>/dev/null || true)
    if [ -z "${mints:-}" ]; then
      continue
    fi

    while IFS= read -r mint; do
      [ -z "${mint:-}" ] && continue
      if [ -n "${seen_mints[$mint]:-}]" ]; then
        continue
      fi

      quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_amount}&slippage=1"
      quote_raw=$(curl -s --max-time $TIMEOUT "$quote_url" || echo '')
      if echo "$quote_raw" | jq -e . >/dev/null 2>&1; then
        has_route=$(echo "$quote_raw" | jq -r 'if (.routePlan? | length > 0) or (.data? | length > 0) then "true" else "false" end' 2>/dev/null || echo "false")
        swapUsd=$(echo "$quote_raw" | jq -r '.swapUsdValue // empty' 2>/dev/null || echo '')
        # compact summary: swapUsd + route count
        route_count=$(echo "$quote_raw" | jq -r '(.routePlan? | length) // 0' 2>/dev/null || echo 0)
        jq_summary="{\"swapUsd\":\"${swapUsd}\",\"routeCount\":${route_count}}"
      else
        has_route="false"
        jq_summary=""
        swapUsd=""
      fi
      if [ "$has_route" = "true" ]; then
        route=YES
      else
        route=NO
      fi

      if [ "$age" -le "$AGE_THRESHOLD" ] && [ "$route" = "YES" ]; then
        seen_mints[$mint]=1
        echo -e "${mint}\t${age}\t${route}\t\tACCEPTED\t${swapUsd}\t${jq_summary}"
      fi

    done <<< "$mints"

  done <<< "$signatures"

  sleep $POLL_INTERVAL
done

echo
echo "Search finished (duration=${DURATION}s)."
