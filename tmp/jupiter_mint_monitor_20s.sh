#!/usr/bin/env bash
set -euo pipefail

# مراقب سريع لمدة محددة لجلب مِنتات Solana الجديدة وطباعتها فوراً
# يطبع أي مِنت له اقتباس من Jupiter أو بيانات من pump.fun أو عمر <= AGE_THRESHOLD

RPC=https://api.mainnet-beta.solana.com
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
LIMIT=200
TIMEOUT=8
DURATION=20    # مدة التشغيل بالثواني
POLL_INTERVAL=2
AGE_THRESHOLD=60

# جلب سعر SOL وحساب lamports لمعادلة $200
sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi
lamports_for_200=$(awk -v p="$sol_price" 'BEGIN{printf "%d", (200.0 / p) * 1e9 }')

echo "تشغيل المراقب لمدة ${DURATION}s — LIMIT=${LIMIT}, poll every ${POLL_INTERVAL}s"
echo "سعر SOL=$sol_price — lamports for \$200 = $lamports_for_200"

echo -e "MintAddress\tAge(s)\tRoute\tPump\tNotes\tJupiterQuote\tPumpData"

declare -A seen_sigs=()
declare -A seen_mints=()
start_ts=$(date +%s)

while [ $(( $(date +%s) - start_ts )) -lt $DURATION ]; do
  # جلب آخر LIMIT تواقيع
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
      if [ -n "${seen_mints[$mint]:-}" ]; then
        continue
      fi

      # اطلب اقتباس من Jupiter
      quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_200}&slippage=1"
      quote_raw=$(curl -s --max-time $TIMEOUT "$quote_url" || echo '')
      if echo "$quote_raw" | jq -e . >/dev/null 2>&1; then
        has_route=$(echo "$quote_raw" | jq -r 'if (.routePlan? | length > 0) or (.data? | length > 0) then "true" else "false" end' 2>/dev/null || echo "false")
        quote_compact=$(echo "$quote_raw" | jq -c . 2>/dev/null || echo '')
      else
        has_route="false"
        quote_compact=""
      fi
      if [ "$has_route" = "true" ]; then
        route=YES
      else
        route=NO
      fi

      # فحص pump.fun
      pump_raw=$(curl -s --max-time $TIMEOUT "https://frontend-api.pump.fun/coins/${mint}" || echo '')
      if echo "$pump_raw" | jq -e . >/dev/null 2>&1; then
        pump_name=$(echo "$pump_raw" | jq -r '.name // empty' || echo '')
        pump_compact=$(echo "$pump_raw" | jq -c . 2>/dev/null || echo '')
      else
        pump_name=''
        pump_compact=''
      fi
      if [ -n "${pump_name}" ]; then
        pump=YES
      else
        pump=NO
      fi

      notes=""
      if [ $age -le 1 ] && [ "$route" = "YES" ]; then
        notes="ACCEPTED"
      fi

      # اطبع إذا كان لديه اقتباس أو pump أو عمر <= AGE_THRESHOLD
      if [ -n "${quote_compact}" ] || [ -n "${pump_compact}" ] || [ "$age" -le "$AGE_THRESHOLD" ]; then
        seen_mints[$mint]=1
        echo -e "${mint}\t${age}\t${route}\t${pump}\t${notes}\t${quote_compact}\t${pump_compact}"
      fi

    done <<< "$mints"

  done <<< "$signatures"

  sleep $POLL_INTERVAL
done

echo
echo "انتهى المراقب (duration=${DURATION}s)."
