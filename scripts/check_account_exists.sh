#!/usr/bin/env bash
set -euo pipefail
# check_account_exists.sh
# Usage: ./check_account_exists.sh <ADDRESS>

RPC=${RPC:-https://api.mainnet-beta.solana.com}
ADDR=${1:?Please provide an account address}

echo "Checking account $ADDR on $RPC..."
RESP=$(curl -sS "$RPC" -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["'"$ADDR"'", {"encoding":"base64"}] }')

FOUND=$(echo "$RESP" | jq -r '.result.value != null')
if [ "$FOUND" = "true" ]; then
  echo "Account exists."
  echo "$RESP" | jq -C '.result.value | {owner: .owner, lamports: .lamports, data_present: (.data | length > 0)}'
else
  echo "Account does not exist (null)."
fi
