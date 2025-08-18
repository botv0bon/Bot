#!/usr/bin/env bash
set -euo pipefail

RPC=https://api.mainnet-beta.solana.com
INPUT=/workspaces/Bot/tmp/jupiter_init_found_5m.tsv
TIMEOUT=10

if [ ! -f "$INPUT" ]; then
  echo "Input file not found: $INPUT"; exit 1
fi

# Read file skipping header
tail -n +2 "$INPUT" | awk -F"\t" '{print $1}' | while IFS= read -r mint; do
  [ -z "${mint:-}" ] && continue
  echo
  echo "==== Mint: $mint ===="

  # fetch signatures for this mint
  sigs=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$mint\",{"limit":20}]}" | jq -r '.result[]?.signature' || true)
  if [ -z "${sigs:-}" ]; then
    echo "No signatures found for mint $mint"; continue
  fi

  found=0
  for sig in $sigs; do
    tx=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' "$RPC" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"encoding\":\"jsonParsed\"}]}" ) || true
    if echo "$tx" | jq -e ".result" >/dev/null 2>&1; then
      # check if mint string appears in tx JSON (in any field)
      if echo "$tx" | jq -e --arg m "$mint" 'tostring | contains($m)' >/dev/null 2>&1; then
        slot=$(echo "$tx" | jq -r '.result.slot // empty')
        blocktime=$(echo "$tx" | jq -r '.result.blockTime // empty')
        echo "Signature: $sig"
        echo "Slot: $slot  BlockTime: $blocktime"
        echo "Accounts:"
        echo "$tx" | jq -r '.result.transaction.message.accountKeys[]? | " - \(.)"'
        echo
        echo "Instructions (parsed):"
        echo "$tx" | jq -r '.result.transaction.message.instructions[]? | {program: .program, parsed: .parsed} | @json' | jq -s '.'
        echo
        echo "Meta - preTokenBalances/postTokenBalances for this mint:"
        echo "$tx" | jq -r --arg m "$mint" '.result.meta.preTokenBalances[]? | select(.mint==$m) // empty, .result.meta.postTokenBalances[]? | select(.mint==$m) // empty' 2>/dev/null || true
        found=1
        break
      fi
    fi
  done

  if [ $found -eq 0 ]; then
    echo "No transaction containing mint string found among recent signatures (tried up to 20)."
  fi

done
