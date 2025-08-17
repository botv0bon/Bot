#!/usr/bin/env bash
set -euo pipefail
# summarize_errored.sh
# Usage: ./summarize_errored.sh [ADDRESS] [LIMIT]
# Example: ./summarize_errored.sh TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA 100

RPC=${RPC:-https://api.mainnet-beta.solana.com}
ADDR=${1:-TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA}
LIMIT=${2:-100}
MAX_SHOW=${3:-10}

echo "Fetching up to $LIMIT signatures for $ADDR from $RPC..."
SIGS_JSON=$(curl -sS "$RPC" -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["'"$ADDR"'", {"limit":'"$LIMIT"'}] }')

ERR_SIGS=$(echo "$SIGS_JSON" | jq -r '.result[]? | select(.err != null) | .signature')

if [ -z "$(echo "$ERR_SIGS" | tr -d '\n')" ]; then
  echo "No errored signatures found in the last $LIMIT entries.";
  exit 0
fi

count=0
for sig in $(echo "$ERR_SIGS" | head -n $MAX_SHOW); do
  count=$((count+1))
  echo
  echo "---- #$count errored signature: $sig ----"
  curl -sS "$RPC" -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["'"$sig"'", {"encoding":"jsonParsed","maxSupportedTransactionVersion":0}] }' | jq -C '.result as $r | {signature: $r.transaction.signatures[0], slot: $r.slot, blockTime: $r.blockTime, status: $r.meta.status, err: $r.meta.err, computeUnitsConsumed: $r.meta.computeUnitsConsumed, fee: $r.meta.fee, logMessages: $r.meta.logMessages, preTokenBalances: $r.meta.preTokenBalances, postTokenBalances: $r.meta.postTokenBalances, instructions: $r.transaction.message.instructions }'
  echo
done

echo "Displayed $count errored signatures (max $MAX_SHOW)."
