#!/usr/bin/env bash
set -euo pipefail

RPC=https://api.mainnet-beta.solana.com
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
INPUT=/workspaces/Bot/tmp/jupiter_init_found_5m.tsv
LIMIT=1000
TIMEOUT=10

if [ ! -f "$INPUT" ]; then
  echo "Input not found: $INPUT"; exit 1
fi

# read mints
mapfile -t mints < <(tail -n +2 "$INPUT" | awk -F"\t" '{print $1}')
if [ ${#mints[@]} -eq 0 ]; then
  echo "No mints in input file"; exit 1
fi

echo "Scanning last $LIMIT signatures of TOKEN_PROGRAM for these mints:"
for m in "${mints[@]}"; do echo " - $m"; done

echo
sigs_json=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$TOKEN_PROGRAM\",{\"limit\":$LIMIT}]}" ) || true
signatures=$(echo "$sigs_json" | jq -r '.result[]?.signature' || true)

if [ -z "${signatures:-}" ]; then
  echo "No signatures returned for TOKEN_PROGRAM"; exit 0
fi

found_any=0
for sig in $signatures; do
  tx=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"encoding\":\"jsonParsed\"}]}" ) || true
  if ! echo "$tx" | jq -e ".result" >/dev/null 2>&1; then
    continue
  fi
  # check for any mint
  for m in "${mints[@]}"; do
    if echo "$tx" | jq -e --arg m "$m" 'tostring | contains($m)' >/dev/null 2>&1; then
      found_any=1
      slot=$(echo "$tx" | jq -r '.result.slot // empty')
      blocktime=$(echo "$tx" | jq -r '.result.blockTime // empty')
      echo
      echo "=== Found mint $m in tx $sig ==="
      echo "Slot: $slot  BlockTime: $blocktime"
      echo "Accounts:"
      echo "$tx" | jq -r '.result.transaction.message.accountKeys[]? | " - \(.)"'
      echo
      echo "Instructions (parsed if present):"
      echo "$tx" | jq -r '.result.transaction.message.instructions[]? | {program: .program, parsed: .parsed} | @json' | jq -s '.'
      echo
      echo "Meta pre/post token balances for $m (if any):"
      echo "$tx" | jq -r --arg m "$m" '.result.meta.preTokenBalances[]? | select(.mint==$m) // empty, .result.meta.postTokenBalances[]? | select(.mint==$m) // empty' 2>/dev/null || true
      # continue searching for other occurrences
    fi
  done
done

if [ $found_any -eq 0 ]; then
  echo "No transactions in the scanned signatures contained the given mints."
fi
