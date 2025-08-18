#!/usr/bin/env bash
set -euo pipefail

RPC=https://api.mainnet-beta.solana.com
SYSTEM_PROGRAM=11111111111111111111111111111111
TOKEN_PROGRAM=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
SLOTS_BACK=200
OUT=/workspaces/Bot/tmp/system_block_scan_results_fixed.tsv
TIMEOUT=12

slot=$(curl -s --max-time $TIMEOUT -X POST -H "Content-Type: application/json" $RPC -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq -r .result)
if [ -z "$slot" ] || [ "$slot" = "null" ]; then echo "Failed to get slot"; exit 1; fi
start=$((slot - SLOTS_BACK))
[ $start -lt 0 ] && start=0

echo -e "slot\tsignature\tblockTime\tcandidate\tnote" > "$OUT"

for s in $(seq $start $slot); do
  blk=$(curl -s --max-time $TIMEOUT -X POST -H "Content-Type: application/json" $RPC -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBlock\",\"params\":[${s},{\"encoding\":\"jsonParsed\",\"maxSupportedTransactionVersion\":0}]}" ) || continue
  if ! echo "$blk" | jq -e .result >/dev/null 2>&1; then continue; fi
  blocktime=$(echo "$blk" | jq -r '.result.blockTime // ""')

  echo "$blk" | jq -r --arg sys "$SYSTEM_PROGRAM" --arg tok "$TOKEN_PROGRAM" --arg slot "$s" --arg btime "$blocktime" '
    .result.transactions[]? as $tx
    | ($tx.transaction.message.instructions[]? , ($tx.meta.innerInstructions[]?.instructions[]?)) as $ins
    | if ($ins.programId == $sys) and (($ins.parsed?.type=="createAccount") or ($ins.parsed?.type=="create")) then
        [$slot, ($tx.transaction.signatures[0] // ""), $btime, ($ins.parsed.info.newAccount // $ins.parsed.info.newAccountPubkey // ($ins.accounts[1]? // $ins.accounts[0]? // "")), "createAccount"]
      elif ($ins.programId == $tok) and ($ins.parsed?.type=="initializeMint") then
        [$slot, ($tx.transaction.signatures[0] // ""), $btime, ($ins.parsed.info.mint // ($ins.accounts[0]? // "")), "initializeMint"]
      else empty end
    | @tsv
  ' >> "$OUT"

done

echo "Scan complete — results saved to $OUT"
