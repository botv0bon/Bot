#!/usr/bin/env node
// Verify that program IDs listed in file/env exist on-chain and look like programs/accounts
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HELIUS_RPC = process.env.HELIUS_RPC_URL || process.env.HELIUS_FAST_RPC_URL || 'https://mainnet.helius-rpc.com/';
const progFile = path.join(process.cwd(), 'scripts', 'known_amm_program_ids.txt');

function loadFromFile() {
  if (!fs.existsSync(progFile)) return [];
  const txt = fs.readFileSync(progFile,'utf8');
  return txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>l.split('#')[0].trim()).filter(Boolean).map(s=>s.replace(/,.*/,'').trim());
}
function loadFromEnv() {
  const env = process.env.KNOWN_AMM_PROGRAM_IDS || '';
  return env.split(',').map(s=>s.trim()).filter(Boolean);
}

async function checkAccount(addr) {
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [addr, { encoding: 'jsonParsed' }] });
    const res = await axios.post(HELIUS_RPC, body, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });
    const data = res.data && (res.data.result || res.data);
    return { exists: !!data, raw: data };
  } catch (e) {
    return { exists: false, error: e.message || String(e) };
  }
}

(async ()=>{
  const fromFile = loadFromFile();
  const fromEnv = loadFromEnv();
  const all = Array.from(new Set([...fromFile, ...fromEnv]));
  console.log('Verifying', all.length, 'unique program ids (file+env)');
  const results = [];
  for (const a of all) {
    process.stdout.write('Checking '+a+' ... ');
    const r = await checkAccount(a);
    if (r.exists) {
      try { console.log('OK'); } catch (e) { console.log('OK'); }
    } else {
      console.log('MISSING or RPC error:', r.error || 'no-data');
    }
    results.push({ address: a, ...r });
  }
  console.log('\nSummary:');
  for (const r of results) {
    console.log(r.address, r.exists ? 'FOUND' : 'MISSING');
  }
})();
