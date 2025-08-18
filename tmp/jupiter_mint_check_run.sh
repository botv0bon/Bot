#!/usr/bin/env bash
set -euo pipefail

TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
RPC=https://api.mainnet-beta.solana.com
LIMIT=200
TIMEOUT=8
AGE_THRESHOLD=60

# جلب توقيعات
echo "جاري جلب آخر ${LIMIT} تواقيع من برنامج SPL Token..."
signatures=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$TOKEN_PROGRAM\",{\"limit\":$LIMIT}]}" | jq -r '.result[]?.signature' || true)
if [ -z "${signatures:-}" ]; then
  echo "لم يُعثر على تواقيع أو حدث خطأ"; exit 0
fi

# جلب سعر SOL
sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi
lamports_for_200=$(awk -v p="$sol_price" 'BEGIN{printf "%d", (200.0 / p) * 1e9 }')

echo "سعر SOL=$sol_price"
echo "كمية lamports لمعادلة \$200 = $lamports_for_200"

echo
echo "🚀 آخر عملات جديدة على Solana (مرشحون)"
echo -e "MintAddress\tAge(s)\tRoute\tPump\tNotes\tJupiterQuote\tPumpData"

declare -A seen=()

# لكل توقيع، اجلب تفاصيل المعاملة واستخرج المِنتس
while IFS= read -r sig; do
  txdata=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"encoding\":\"jsonParsed\"}]}" ) || true
  blocktime=$(echo "$txdata" | jq -r '.result.blockTime // empty')
  if [ -z "${blocktime:-}" ]; then
    continue
  fi
  age=$(( $(date +%s) - blocktime ))

  # استخرج المِنتسات من postTokenBalances و من innerInstructions (parsed info)
  mints=$(echo "$txdata" | jq -r '[.result.meta.postTokenBalances[]?.mint, .result.meta.innerInstructions[]?.instructions[]?.parsed?.info?.mint] | map(select(.!=null)) | unique | .[]' 2>/dev/null || true)
  if [ -z "${mints:-}" ]; then
    continue
  fi

  while IFS= read -r mint; do
    # تجنب الطباعة المكررة
    if [ -n "${seen[$mint]:-}" ]; then
      continue
    fi
    seen[$mint]=1

    notes=""
  # اطلب اقتباس من Jupiter: SOL -> token بقيمة lamports_for_200 (للتحقق من وجود سيولة >= $200)
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

    # شرط القبول: العمر لحظة (<=1s) ووجود route لِـ $200 (سيولة كافية)
    if [ $age -le 1 ] && [ "$route" = "YES" ]; then
      notes="ACCEPTED"
    else
      notes=""
    fi

    # اطبع المِنتات التي تحتوي على بيانات Jupiter أو بيانات pump أو عمرها <= AGE_THRESHOLD
    if [ -n "${quote_compact}" ] || [ -n "${pump_compact}" ] || [ "$age" -le "$AGE_THRESHOLD" ]; then
      echo -e "${mint}\t${age}\t${route}\t${pump}\t${notes}\t${quote_compact}\t${pump_compact}"
    fi
  done <<< "$mints"

done <<< "$signatures"

echo
echo "انتهى الفحص."
