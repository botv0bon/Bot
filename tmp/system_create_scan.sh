#!/usr/bin/env bash
set -euo pipefail

# Scan recent signatures interacting with System Program for createAccount instructions
# If a createAccount is followed by initializeMint for the new account, treat it as a mint
# Then query Jupiter quote for amount $50 to check liquidity

RPC=https://api.mainnet-beta.solana.com
SYSTEM_PROGRAM=11111111111111111111111111111111
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
LIMIT=2000
TIMEOUT=10
AMOUNT_USD=50
OUTFILE=/workspaces/Bot/tmp/system_create_mints.tsv

sol_price=$(curl -s --max-time 10 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd' | jq -r '.solana.usd')
if [ -z "${sol_price:-}" ] || [ "$sol_price" = "null" ]; then
  echo "خطأ: لم يتم الحصول على سعر SOL"; exit 1
fi
lamports_for_amount=$(awk -v p="$sol_price" -v a="$AMOUNT_USD" 'BEGIN{printf "%d", (a / p) * 1e9 }')

echo "Scanning last ${LIMIT} signatures for System Program createAccount -> initializeMint (amount=\$${AMOUNT_USD})"
echo "SOL=$sol_price lamports_for_${AMOUNT_USD}=${lamports_for_amount}"

echo -e "MintAddress\tAge(s)\tSignature\tSlot\tSwapUsdValue\tRouteCount\tSource" > "$OUTFILE"

sigs_json=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$SYSTEM_PROGRAM\",{\"limit\":$LIMIT}]}" ) || true
signatures=$(echo "$sigs_json" | jq -r '.result[]?.signature' || true)

if [ -z "${signatures:-}" ]; then
  echo "No signatures returned for system program"; exit 0
fi

declare -A seen_mints=()

for sig in $signatures; do
  tx=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"encoding\":\"jsonParsed\"}]}" ) || true
  if ! echo "$tx" | jq -e ".result" >/dev/null 2>&1; then
    continue
  fi

  blocktime=$(echo "$tx" | jq -r '.result.blockTime // empty')
  slot=$(echo "$tx" | jq -r '.result.slot // empty')
  age=""
  if [ -n "$blocktime" ]; then
    age=$(( $(date +%s) - blocktime ))
  fi

  # find createAccount instructions
  create_accounts=$(echo "$tx" | jq -r --arg sp "$SYSTEM_PROGRAM" '[.result.transaction.message.instructions[]? , .result.meta.innerInstructions[]?.instructions[]?] | flatten | map(select(.programId==$sp and (.parsed?.type=="createAccount" or .parsed?.type=="create"))) | map(.parsed.info.newAccount // .parsed.info.newAccountPubkey // .accounts[1] // .parsed.info.account // .accounts[0]) | unique | .[]' 2>/dev/null || true)
  if [ -z "${create_accounts:-}" ]; then
    continue
  fi

  # also check initializeMint instructions in same tx
  init_mints=$(echo "$tx" | jq -r --arg tp "$TOKEN_PROGRAM" '[.result.transaction.message.instructions[]? , .result.meta.innerInstructions[]?.instructions[]?] | flatten | map(select(.programId==$tp and (.parsed?.type=="initializeMint"))) | map(.parsed.info.mint // .accounts[0]) | unique | .[]' 2>/dev/null || true)

  # correlate: if init_mints present, consider them
  for mint in $init_mints; do
    [ -z "${mint:-}" ] && continue
    if [ -n "${seen_mints[$mint]:-}" ]; then
      continue
    fi

    # query Jupiter for liquidity
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

    if [ "$has_route" = "true" ]; then
      seen_mints[$mint]="sig=$sig slot=$slot age=$age"
      echo -e "${mint}\t${age}\t${sig}\t${slot}\t${swapUsd}\t${route_count}\tinit_mint" | tee -a "$OUTFILE"
    fi
  done

  # also consider create_accounts entries that might be mints (rare)
  for acct in $create_accounts; do
    [ -z "${acct:-}" ] && continue
    # skip if already handled
    if [ -n "${seen_mints[$acct]:-}" ]; then
      continue
    fi
    # try Jupiter query treating acct as mint
    quote_url="https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${acct}&amount=${lamports_for_amount}&slippage=1"
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
    if [ "$has_route" = "true" ]; then
      seen_mints[$acct]="sig=$sig slot=$slot age=$age"
      echo -e "${acct}\t${age}\t${sig}\t${slot}\t${swapUsd}\t${route_count}\tcreate_account" | tee -a "$OUTFILE"
    fi
  done

done

echo "Scan complete. Results saved to $OUTFILE"
