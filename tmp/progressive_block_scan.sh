#!/usr/bin/env bash
set -euo pipefail

RPC='https://api.mainnet-beta.solana.com'
AMOUNT_USD=300
OUT=/workspaces/Bot/tmp/progressive_scan_results.txt

sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd // ""')
if [ -z "${sol_price}" ] || [ "${sol_price}" = "null" ] || [ "${sol_price}" = "0" ]; then
  echo 'ERROR: cannot fetch SOL price' >&2
  exit 1
fi
lamports=$(awk -v p="$sol_price" -v a="$AMOUNT_USD" 'BEGIN{printf "%d", (a / p) * 1e9 }')
slot=$(curl -s --max-time 10 -X POST -H 'Content-Type: application/json' "$RPC" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq -r '.result // empty')
if [ -z "${slot}" ]; then echo 'ERROR: cannot get current slot' >&2; exit 1; fi

printf "Progressive scan starting (amount=\$%s, lamports=%s)\n" "$AMOUNT_USD" "$lamports"
: > "$OUT"

for N in 200 500 1000; do
  printf "\n--- Scan last %d blocks ---\n" "$N" | tee -a "$OUT"
  start=$((slot - N + 1))
  [ $start -lt 0 ] && start=0
  found_any=0
  for ((s=start; s<=slot; s++)); do
    block=$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBlock\",\"params\":[${s},{\"encoding\":\"jsonParsed\",\"transactionDetails\":\"full\"}]}" ) || continue
    bt=$(echo "$block" | jq -r '.result.blockTime // empty')
    [ -z "${bt}" ] && continue
    txs=$(echo "$block" | jq -c '.result.transactions[]?' 2>/dev/null || true)
    [ -z "${txs}" ] && continue
    while IFS= read -r tx; do
      candidates=$(echo "$tx" | jq -r '([.transaction.message.instructions[]? , .meta.innerInstructions[]?.instructions[]?] | flatten | map(.parsed?.info? // {}) | map(.mint // .newAccount // .account // .destination // .authority // empty) | map(select(. != null and . != "")) | unique)[]' 2>/dev/null || true)
      [ -z "${candidates}" ] && continue
      while IFS= read -r mint; do
        mint=$(echo "$mint" | tr -d '"')
        [ -z "${mint}" ] && continue
        quote=$(curl -s --max-time 6 "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippage=1" || echo '')
        if ! echo "$quote" | jq -e . >/dev/null 2>&1; then
          continue
        fi
        has=$(echo "$quote" | jq -r 'if (.routePlan? | length>0) or (.data? | length>0) then "true" else "false" end' 2>/dev/null || echo 'false')
        if [ "$has" != "true" ]; then
          continue
        fi
        swapUsd=$(echo "$quote" | jq -r '.swapUsdValue // ""' 2>/dev/null || echo '')
        printf "FOUND: N=%d mint=%s slot=%d blockTime=%s swapUsd=%s\n" "$N" "$mint" "$s" "$bt" "$swapUsd" | tee -a "$OUT"
        found_any=1
      done <<< "$candidates"
      if [ $found_any -eq 1 ]; then break; fi
    done <<< "$txs"
    if [ $found_any -eq 1 ]; then break; fi
  done
  if [ $found_any -eq 0 ]; then
    printf "No matches in last %d blocks.\n" "$N" | tee -a "$OUT"
  else
    printf "Matches found for N=%d — stopping further larger scans.\n" "$N" | tee -a "$OUT"
    break
  fi
done

printf "Scan finished. Results saved to %s\n" "$OUT"
