#!/usr/bin/env node
// precreate-check.js
// Usage: node scripts/precreate-check.js <targetPubkey> [rpc]
// Example: node scripts/precreate-check.js Gp6raMys3nZHFwQEMp2oTV859iNuoXJoXxPmwH7o6iLF

const { execSync } = require('child_process');
const addr = process.argv[2];
const rpc = process.argv[3] || process.env.RPC || 'https://api.mainnet-beta.solana.com';
if (!addr) {
  console.error('Missing target pubkey');
  process.exit(2);
}
try {
  const body = JSON.stringify({ jsonrpc: '2.0', id:1, method: 'getAccountInfo', params: [addr, { encoding: 'jsonParsed' }] });
  const out = execSync(`curl -sS ${rpc} -X POST -H "Content-Type: application/json" -d '${body}'` , { encoding: 'utf8' });
  const j = JSON.parse(out);
  const exists = j.result && j.result.value !== null;
  if (exists) {
    console.log(JSON.stringify({ exists: true, owner: j.result.value.owner, lamports: j.result.value.lamports }, null, 2));
    process.exit(0);
  } else {
    console.log(JSON.stringify({ exists: false }, null, 2));
    process.exit(0);
  }
} catch (e) {
  console.error('Request failed', e.message);
  process.exit(1);
}
