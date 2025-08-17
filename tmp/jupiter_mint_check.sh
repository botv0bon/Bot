#!/usr/bin/env bash
set -euo pipefail

TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
RPC=https://api.mainnet-beta.solana.com
LIMIT=10
TIMEOUT=15

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
lamports_for_500=$(awk -v p="$sol_price" 'BEGIN{printf "%d", (500.0 / p) * 1e9 }')

echo "سعر SOL=$sol_price"
echo "كمية lamports لمعادلة $500 = $lamports_for_500"

echo
echo "🚀 آخر عملات جديدة على Solana (مرشحون)"
echo -e "MintAddress\tAge(s)\tRoute\tPump\tNotes"

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
    notes=""
    # اطلب اقتباس من Jupiter: SOL -> token بقيمة lamports_for_500
    quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_500}&slippage=1"
    quote=$(curl -s --max-time $TIMEOUT "$quote_url" || echo '{}')
    has_route=$(echo "$quote" | jq -r 'if (.routePlan? | length > 0) or (.data? | length > 0) then "true" else "false" end' 2>/dev/null || echo "false")
    if [ "$has_route" = "true" ]; then
      route=YES
    else
      route=NO
    fi

    # فحص pump.fun
    pump_name=$(curl -s --max-time $TIMEOUT "https://frontend-api.pump.fun/coins/${mint}" | jq -r '.name // empty' || echo '')
    if [ -n "${pump_name}" ]; then
      pump=YES
    else
      pump=NO
    fi

    # شرط القبول: العمر <=1s أو وجود route
    if [ $age -le 1 ] || [ "$route" = "YES" ]; then
      notes="ACCEPTED"
    fi

    echo -e "${mint}\t${age}\t${route}\t${pump}\t${notes}"
  done <<< "$mints"

done <<< "$signatures"

echo
echo "انتهى الفحص."
