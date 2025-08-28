#!/usr/bin/env node
// Check recent activity for program IDs using Helius getSignaturesForAddress
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

async function getSignatures(addr) {
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [addr, { limit: 1 }] });
    const res = await axios.post(HELIUS_RPC, body, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });
    const data = res.data && (res.data.result || res.data);
    return data;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

(async ()=>{
  const fromFile = loadFromFile();
  const fromEnv = loadFromEnv();
  const all = Array.from(new Set([...fromFile, ...fromEnv]));
  console.log('Checking activity for', all.length, 'unique program ids');
  const results = [];
  for (const a of all) {
    process.stdout.write('Checking '+a+' ... ');
    const r = await getSignatures(a);
    if (Array.isArray(r) && r.length>0) {
      console.log('ACTIVE (latest sig:', r[0].signature, ')');
      results.push({ address: a, active: true, latest: r[0] });
    } else if (Array.isArray(r) && r.length===0) {
      console.log('NO RECENT SIGS');
      results.push({ address: a, active: false, latest: null });
    } else {
      console.log('ERROR', r.error || JSON.stringify(r).slice(0,80));
      results.push({ address: a, active: false, error: r.error || r });
    }
  }
  console.log('\nSummary:');
  for (const r of results) {
    console.log(r.address, r.active ? 'ACTIVE' : 'INACTIVE/ERR');
  }
})();
