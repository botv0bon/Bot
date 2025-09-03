#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const OUT_DIR = path.join(process.cwd(), 'out');
const QUEUE_DIR = path.join(OUT_DIR, 'capture_queue');
try{ fs.mkdirSync(QUEUE_DIR, { recursive: true }); }catch(e){}

const _HELIUS_KEYS = (process.env.HELIUS_API_KEYS || process.env.HELIUS_API_KEY || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
const HELIUS_RPC_URLS = (process.env.HELIUS_RPC_URLS || process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
if(_HELIUS_KEYS.length===0){ const k = process.env.HELIUS_API_KEY || ''; if(k) _HELIUS_KEYS.push(k); }
if(HELIUS_RPC_URLS.length===0){ HELIUS_RPC_URLS.push('https://mainnet.helius-rpc.com/'); }
let heliusCallCounter = 0;
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function heliusRpc(method, params){
  try{
    const keyIdx = heliusCallCounter % Math.max(1, _HELIUS_KEYS.length);
    const urlIdx = heliusCallCounter % Math.max(1, HELIUS_RPC_URLS.length);
    heliusCallCounter = (heliusCallCounter + 1) >>> 0;
    const url = HELIUS_RPC_URLS[urlIdx];
    const hdrs = Object.assign({ 'Content-Type': 'application/json' }, _HELIUS_KEYS[keyIdx] ? { 'x-api-key': _HELIUS_KEYS[keyIdx] } : {});
    const res = await axios.post(url, { jsonrpc:'2.0', id:1, method, params }, { headers: hdrs, timeout:15000 });
    return res.data && (res.data.result || res.data);
  }catch(e){ return { __error: e.message || String(e), status: e.response && e.response.status }; }
}

const PROGRAMS = [
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  '9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp',
  'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu'
];

function getSig(entry){ if(!entry) return null; return entry.signature || entry.txHash || entry.sig || entry.txhash || null; }
function joinTxLogs(tx){ try{ const logs = (tx && tx.meta && Array.isArray(tx.meta.logMessages)) ? tx.meta.logMessages : []; return logs.join('\n').toLowerCase(); }catch(e){ return ''; } }
function extractMints(tx){ const s = new Set(); try{ const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {}; const arr = [].concat(meta.preTokenBalances||[], meta.postTokenBalances||[]); for(const b of arr) if(b && b.mint) s.add(b.mint); const inner = meta.innerInstructions || []; for(const block of inner){ const instrs = block && block.instructions || []; for(const ins of instrs){ try{ const pt = ins && ins.parsed && ins.parsed.info && (ins.parsed.info.mint || ins.parsed.info.postTokenBalances); if(pt){ if(Array.isArray(pt)) for(const x of pt) if(x && x.mint) s.add(x.mint); else if(pt) s.add(pt); } }catch(e){} } } }catch(e){} return Array.from(s); }
function txKindExplicit(tx){ try{ const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {}; const logs = Array.isArray(meta.logMessages)? meta.logMessages.join('\n').toLowerCase() : ''; if(logs.includes('instruction: initializemint') || logs.includes('initialize mint') || logs.includes('instruction: initialize_mint')) return 'initialize'; if(logs.includes('instruction: swap') || logs.includes('\nprogram log: instruction: swap') || logs.includes(' swap ')) return 'swap'; const msg = tx && (tx.transaction && tx.transaction.message) || tx.transaction || {}; const instrs = (msg && msg.instructions) || []; for(const ins of instrs){ try{ const t = (ins.parsed && ins.parsed.type) || (ins.type || ''); if(!t) continue; const lt = String(t).toLowerCase(); if(lt.includes('initializemint')||lt.includes('initialize_mint')||lt.includes('initialize mint')) return 'initialize'; if(lt.includes('swap')) return 'swap'; }catch(e){} } }catch(e){} return null; }

async function runCapture(){
  console.error('capture-only listener starting');
  const lastSigPerProgram = new Map();
  while(true){
    for(const p of PROGRAMS){
      try{
        const sigs = await heliusRpc('getSignaturesForAddress', [p, { limit: 5 }]);
        if(!Array.isArray(sigs) || sigs.length===0){ await sleep(250); continue; }
        // look for the newest unseen signature
        let s = sigs[0];
        for(const cand of sigs){ const candSig = getSig(cand); if(!candSig) continue; if(lastSigPerProgram.get(p) === candSig) continue; s = cand; break; }
        const sig = getSig(s); if(!sig) { await sleep(250); continue; }
        lastSigPerProgram.set(p, sig);
        const tx = await heliusRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        if(!tx || tx.__error) { await sleep(120); continue; }
        const kind = txKindExplicit(tx); if(!kind) { await sleep(120); continue; }
        // accept initialize always; accept swap as candidate without extra probes (capture-only)
        if(!(kind === 'initialize' || kind === 'swap')) { await sleep(120); continue; }
        const mints = extractMints(tx).filter(x=>x);
        if(!mints || mints.length===0){ await sleep(120); continue; }
        const sampleLogs = (tx.meta && tx.meta.logMessages) ? tx.meta.logMessages.slice(0,10) : [];
        const evt = { time: new Date().toISOString(), program: p, signature: sig, kind, mints, sampleLogs };
        // write to queue atomically
        const fileName = Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.json';
        const tmp = path.join(QUEUE_DIR, '.'+fileName+'.tmp');
        const outp = path.join(QUEUE_DIR, fileName);
        try{ fs.writeFileSync(tmp, JSON.stringify(evt, null, 2), 'utf8'); fs.renameSync(tmp, outp); console.error('CAPTURED', outp); }catch(e){ console.error('CAPTURE_WRITE_ERR', e && e.message); }
        // small sleep to avoid tight loop
        await sleep(120);
      }catch(e){ console.error('CAPTURE_ERR', e && e.message); await sleep(200); }
    }
    await sleep(200);
  }
}

if(require.main === module){ runCapture().catch(e=>{ console.error('fatal', e && e.message); process.exit(1); }); }
