#!/usr/bin/env bash
set -euo pipefail

# Scan last N blocks for createAccount / initializeMint patterns, filter tokens with age<=60s
# and Jupiter liquidity >= $300; compute price & market cap when possible; save TSV.

RPC=https://api.mainnet-beta.solana.com
BLOCKS=120
TIMEOUT=8
AMOUNT_USD=300
OUT=/workspaces/Bot/tmp/block_scan_results.tsv
AGE_MAX=60   # accept tokens up to 60s old

sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "Cannot fetch SOL price"; exit 1
fi
lamports_for_amount=$(awk -v p="$sol_price" -v a="$AMOUNT_USD" 'BEGIN{printf "%d", (a / p) * 1e9 }')

echo "Scanning last $BLOCKS blocks — looking for mints age<=${AGE_MAX}s with Jupiter liquidity >= \$${AMOUNT_USD}"

echo -e "Mint\tAge(s)\tSwapUsd\tOutAmount\tDecimals\tSupply\tPrice\tMarketCap\tName\tSymbol\tRouteCount\tTxSignature\tSlot\tBlockTime" > "$OUT"

# get current slot
slot=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq -r '.result')
start_slot=$((slot - BLOCKS + 1))
if [ $start_slot -lt 0 ]; then start_slot=0; fi

declare -A seen_mints=()
current_ts=$(date +%s)

for s in $(seq $start_slot $slot); do
  block=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBlock\",\"params\":[${s},{\"encoding\":\"jsonParsed\",\"transactionDetails\":\"full\"}]}" ) || true
  if ! echo "$block" | jq -e '.result' >/dev/null 2>&1; then
    continue
  fi
  blocktime=$(echo "$block" | jq -r '.result.blockTime // empty')
  if [ -z "${blocktime:-}" ]; then
    continue
  fi
  age_block=$(( current_ts - blocktime ))

  # iterate transactions
  txs=$(echo "$block" | jq -c '.result.transactions[]' 2>/dev/null || true)
  if [ -z "${txs:-}" ]; then
    continue
  fi
  for tx in $txs; do
    sig=$(echo "$tx" | jq -r '.transaction.signatures[0] // empty')
    # collect candidate mints from instructions parsed info
    candidates=$(echo "$tx" | jq -r '[.transaction.message.instructions[]? , .meta.innerInstructions[]?.instructions[]?] | flatten | map(.parsed?.info? // {}) | map(.mint // .newAccount // .account // .destination // .authority // empty) | map(select(.!="")) | unique | .[]' 2>/dev/null || true)
    if [ -z "${candidates:-}" ]; then
      continue
    fi
    for mint in $candidates; do
      # normalize
      mint=$(echo "$mint" | tr -d '"')
      if [ -z "$mint" ]; then continue; fi
      if [ -n "${seen_mints[$mint]:-}" ]; then continue; fi

      # compute age relative to blocktime
      age=$(( current_ts - blocktime ))
      if [ $age -gt $AGE_MAX ]; then
        continue
      fi

      # query Jupiter for liquidity
      quote=$(curl -s --max-time $TIMEOUT "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports_for_amount}&slippage=1" || echo '')
      if ! echo "$quote" | jq -e . >/dev/null 2>&1; then
        continue
      fi
      has_route=$(echo "$quote" | jq -r 'if (.routePlan? | length > 0) or (.data? | length > 0) then "true" else "false" end' 2>/dev/null || echo "false")
      swapUsd=$(echo "$quote" | jq -r '.swapUsdValue // empty' 2>/dev/null || echo '')
      outAmount=$(echo "$quote" | jq -r '.outAmount // empty' 2>/dev/null || echo '')
      routeCount=$(echo "$quote" | jq -r '(.routePlan? | length) // 0' 2>/dev/null || echo 0)
      if [ "$has_route" != "true" ]; then
        continue
      fi
      # ensure swapUsd is numeric
      swapUsdNum=$(echo "$swapUsd" | awk '{printf("%f", $0 + 0)}' 2>/dev/null || echo 0)
      swapUsdFloat=$(printf "%.6f" "$swapUsdNum")
      # filter by volume >= AMOUNT_USD (allow small float error)
      cmp=$(awk -v s=$swapUsdNum -v a=$AMOUNT_USD 'BEGIN{print (s+0.0) >= (a-0.001) ? 1 : 0}')
      if [ "$cmp" -ne 1 ]; then
        continue
      fi

      # get token supply and decimals
      supply_json=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d '{"jsonrpc":"2.0","id":1,"method":"getTokenSupply","params":["'"${mint}"'"]}' ) || true
      supply_amount=$(echo "$supply_json" | jq -r '.result.value.amount // empty' 2>/dev/null || echo '')
      supply_decimals=$(echo "$supply_json" | jq -r '.result.value.decimals // empty' 2>/dev/null || echo '')

      # compute price per token if outAmount and decimals available
      price=""
      marketcap=""
      if [ -n "$outAmount" ] && [ -n "$supply_amount" ] && [ -n "$supply_decimals" ]; then
        # outAmount is integer string representing token units
        outAmtNum=$(echo "$outAmount" | sed 's/"//g')
        denom=$(awk -v d=$supply_decimals 'BEGIN{printf "%f", 10^d}')
        # token amount = outAmtNum / 10^decimals
        tokenAmt=$(awk -v o=$outAmtNum -v d=$supply_decimals 'BEGIN{printf "%f", o / (10^d)}')
        if [ $(awk 'BEGIN{print ('$tokenAmt' > 0)}') -eq 1 ]; then
          price=$(awk -v s=$swapUsdNum -v t=$tokenAmt 'BEGIN{printf "%f", s / t}')
          # supply normalized
          supplyNorm=$(awk -v a=$supply_amount -v d=$supply_decimals 'BEGIN{printf "%f", a / (10^d)}')
          marketcap=$(awk -v p=$price -v s=$supplyNorm 'BEGIN{printf "%f", p * s}')
        fi
      fi

      # pump.fun metadata
      pump_raw=$(curl -s --max-time $TIMEOUT "https://frontend-api.pump.fun/coins/${mint}" || echo '')
      name=$(echo "$pump_raw" | jq -r '.name // empty' 2>/dev/null || echo '')
      symbol=$(echo "$pump_raw" | jq -r '.symbol // empty' 2>/dev/null || echo '')

      echo -e "${mint}\t${age}\t${swapUsdFloat}\t${outAmount}\t${supply_decimals}\t${supply_amount}\t${price}\t${marketcap}\t${name}\t${symbol}\t${routeCount}\t${sig}\t${s}\t${blocktime}" >> "$OUT"
      seen_mints[$mint]=1

    done
  done
done

echo "Done — results saved to $OUT"
