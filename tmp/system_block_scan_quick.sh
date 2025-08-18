#!/usr/bin/env bash
set -euo pipefail

RPC=https://api.mainnet-beta.solana.com
SLOTS_BACK=120
OUT=/workspaces/Bot/tmp/system_block_scan_quick.tsv
TIMEOUT=12

slot=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' $RPC -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq -r .result)
if [ -z "$slot" ] || [ "$slot" = "null" ]; then echo "Failed to get slot"; exit 1; fi
start=$((slot - SLOTS_BACK))
[ $start -lt 0 ] && start=0

echo -e "slot\tsignature\tblockTime\tcandidate\tnote" > "$OUT"

for s in $(seq $start $slot); do
  blk=$(curl -s --max-time $TIMEOUT -X POST -H 'Content-Type: application/json' $RPC -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBlock\",\"params\":[${s},{\"encoding\":\"jsonParsed\",\"maxSupportedTransactionVersion\":0}]}" ) || continue
  if ! echo "$blk" | jq -e .result >/dev/null 2>&1; then continue; fi
  blocktime=$(echo "$blk" | jq -r '.result.blockTime // ""')

  echo "$blk" | jq -r --arg slot "$s" --arg btime "$blocktime" --arg sys "11111111111111111111111111111111" --arg tok "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" '
    .result.transactions[]? as $tx
    | ( [ ($tx.transaction.message.instructions[]? // empty) ] + [ ($tx.meta.innerInstructions[]?.instructions[]? // empty) ] )
    | flatten
    | .[]? as $ins
    | ( if ($ins|type) != "object" then empty
        else
          # normalize program id to string
          ($ins.programId // $ins.program) as $pid
          | ($pid|tostring) as $pidstr
          | if ($pidstr == $sys) and (($ins.parsed?.type == "createAccount") or ($ins.parsed?.type == "create")) then
              [$slot, ($tx.transaction.signatures[0] // ""), $btime, ($ins.parsed.info.newAccount // $ins.parsed.info.newAccountPubkey // ($ins.accounts[1]? // $ins.accounts[0]? // "")), "createAccount"]
            elif ($pidstr == $tok) and ($ins.parsed?.type == "initializeMint") then
              [$slot, ($tx.transaction.signatures[0] // ""), $btime, ($ins.parsed.info.mint // ($ins.accounts[0]? // "")), "initializeMint"]
            else empty end
        end )
    | @tsv
  ' >> "$OUT"

done

echo "Done. Results saved to $OUT"
if [ $(wc -l < "$OUT") -gt 1 ]; then sed -n '1,200p' "$OUT"; else echo "No results."; fi
