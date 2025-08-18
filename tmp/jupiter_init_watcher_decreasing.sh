#!/usr/bin/env bash
set -euo pipefail

# Watch initializeMint and try decreasing USD amounts until a match is found.
# For each amount, run a short watch (DURATION_PER) and stop if we find >=1 matching mint.

RPC=https://api.mainnet-beta.solana.com
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
LIMIT=1000
TIMEOUT=8
DURATION_PER=20
POLL_INTERVAL=2
AGE_THRESHOLD=30
AMOUNTS=(200 100 50 20 10 5)

sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi

echo "بدء التجربة بمقادير متناقصة على initializeMint — كل مقدار مدة ${DURATION_PER}s"
echo "سعر SOL=$sol_price"

declare -A found_mints=()

for amt in "${AMOUNTS[@]}"; do
  lamports_for_amount=$(awk -v p="$sol_price" -v a="$amt" 'BEGIN{printf "%d", (a / p) * 1e9 }')
  echo
  echo "--- تجربة amount=\$$amt (lamports=$lamports_for_amount) لمدة ${DURATION_PER}s ---"

  start_ts=$(date +%s)
  any_found=0

  echo -e "MintAddress\tAge(s)\tSwapUsdValue\tSummary"

  declare -A seen_sigs=()
  declare -A seen_local_mints=()

  while [ $(( $(date +%s) - start_ts )) -lt $DURATION_PER ]; do
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

      init_mints=$(echo "$txdata" | jq -r --arg tp "$TOKEN_PROGRAM" '[.result.transaction.message.instructions[]? , .result.meta.innerInstructions[]?.instructions[]?] | flatten | map(select(.programId==$tp and (.parsed?.type=="initializeMint"))) | map((.parsed?.info?.mint // .accounts[0])) | unique | .[]' 2>/dev/null || true)
      if [ -z "${init_mints:-}" ]; then
        continue
      fi

      while IFS= read -r mint; do
        [ -z "${mint:-}" ] && continue
        if [ -n "${seen_local_mints[$mint]:-}" ]; then
          continue
        fi

        quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_amount}&slippage=1"
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

        if [ "$has_route" = "true" ] && [ "$age" -le "$AGE_THRESHOLD" ]; then
          seen_local_mints[$mint]=1
          found_mints[$mint]="amt=$amt age=$age swapUsd=$swapUsd summary=$jq_summary"
          any_found=1
          echo -e "${mint}\t${age}\t${swapUsd}\t${jq_summary}"
        fi

      done <<< "$init_mints"

    done <<< "$signatures"

    # stop early if found
    if [ $any_found -eq 1 ]; then
      break
    fi

    sleep $POLL_INTERVAL
  done

  if [ $any_found -eq 1 ]; then
    echo "=> تم العثور على نتائج للمقدار \$$amt — إيقاف التجارب الأدنى." 
    break
  else
    echo "لا نتائج لـ \$$amt — متابعة للمقدار التالي."
  fi

done

# عرض ملخص
if [ ${#found_mints[@]} -gt 0 ]; then
  echo
  echo "الملخص — المِنتات التي عُثر عليها:"
  for m in "${!found_mints[@]}"; do
    echo "- ${m} => ${found_mints[$m]}"
  done
else
  echo
  echo "لم تُعثر أي مِنتات ضمن كل المقادير والمحاولات." 
fi
