#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

const PROGRAMS = [
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  '11111111111111111111111111111111',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  '9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp',
  'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu'
];

const RULES = require('./strict_listener_30s.js').RULES || {};
// Fallback if require fails (scripts may not export RULES).

const HELIUS_RPC = process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC || 'https://mainnet.helius-rpc.com/';
const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || '';
const headers = Object.assign({ 'Content-Type': 'application/json' }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {});

async function heliusRpc(method, params){
  try{ const res = await axios.post(HELIUS_RPC, { jsonrpc:'2.0', id:1, method, params }, { headers, timeout:15000 }); return res.data && (res.data.result||res.data); }catch(e){ return { __error: (e.response&&e.response.statusText)||e.message, status: e.response && e.response.status }; }
}

function txKindExplicit(tx){
  try{
    const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {};
    const logs = Array.isArray(meta.logMessages)? meta.logMessages.join('\n').toLowerCase() : '';
    if(logs.includes('instruction: initializemint') || logs.includes('initialize mint') || logs.includes('instruction: initialize_mint')) return 'initialize';
    if(logs.includes('createpool') || logs.includes('initializepool') || logs.includes('create pool')) return 'pool_creation';
    if(logs.includes('instruction: swap') || logs.includes('\nprogram log: instruction: swap') || logs.includes(' swap ')) return 'swap';
    const msg = tx && (tx.transaction && tx.transaction.message) || tx.transaction || {};
    const instrs = (msg && msg.instructions) || [];
    for(const ins of instrs){
      try{ const t = (ins.parsed && ins.parsed.type) || (ins.type || ''); if(!t) continue; const lt = String(t).toLowerCase(); if(lt.includes('initializemint')||lt.includes('initialize_mint')||lt.includes('initialize mint')) return 'initialize'; if(lt.includes('createpool')||lt.includes('initializepool')||lt.includes('create pool')) return 'pool_creation'; if(lt.includes('swap')) return 'swap'; }catch(e){}
    }
  }catch(e){}
  return 'other';
}

function extractMints(tx){
  const s = new Set();
  try{
    const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {};
    const arr = [].concat(meta.preTokenBalances||[], meta.postTokenBalances||[]);
    for(const b of arr) if(b && b.mint) s.add(b.mint);
    const inner = meta.innerInstructions || [];
    for(const block of inner){
      try{ const instrs = block && block.instructions || []; for(const ins of instrs){ try{ const pt = ins && ins.parsed && ins.parsed.info && (ins.parsed.info.mint || ins.parsed.info.postTokenBalances); if(pt){ if(Array.isArray(pt)) for(const x of pt) if(x&&x.mint) s.add(x.mint); else if(pt) s.add(pt); } }catch(e){} } }catch(e){}
    }
  }catch(e){}
  return Array.from(s);
}

async function mintPreviouslySeen(mint, txBlockTime, currentSig){
  if(!mint) return true;
  try{
    const sigs = await heliusRpc('getSignaturesForAddress', [mint, { limit: 20 }]);
    if(!Array.isArray(sigs) || sigs.length===0) return false;
    for(const s of sigs){ const sig = s.signature||s.txHash||s.sig||s.txhash; const bt = s.blockTime||s.block_time||s.blocktime||null; if(sig && sig!==currentSig && bt && txBlockTime && bt < txBlockTime) return true; }
    return false;
  }catch(e){ return true; }
}

(async()=>{
  console.error('Sequential 30s per-program run starting...');
  for(const p of PROGRAMS){
    console.error(`\n--- program ${p} 30s run ---`);
    const end = Date.now()+30000;
    const seenTxs = new Set();
    while(Date.now()<end){
      try{
        const rule = (RULES && RULES[p]) || (RULES && RULES.default) || { allow: ['initialize','pool_creation'] };
        if(!rule || !Array.isArray(rule.allow) || rule.allow.length===0){ await new Promise(r=>setTimeout(r,300)); continue; }
        const sigs = await heliusRpc('getSignaturesForAddress', [p, { limit: 1 }]);
        if(!Array.isArray(sigs)||sigs.length===0){ await new Promise(r=>setTimeout(r,300)); continue; }
        const s = sigs[0]; if(!s) { await new Promise(r=>setTimeout(r,300)); continue; }
        const sig = s.signature||s.txHash||s.sig||s.txhash; if(!sig) { await new Promise(r=>setTimeout(r,300)); continue; }
        if(seenTxs.has(sig)) { await new Promise(r=>setTimeout(r,300)); continue; }
        seenTxs.add(sig);
        const tx = await heliusRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        if(!tx || tx.__error) { await new Promise(r=>setTimeout(r,300)); continue; }
        const kind = txKindExplicit(tx); if(!kind) { await new Promise(r=>setTimeout(r,300)); continue; }
        if(!rule.allow.includes(kind)) { await new Promise(r=>setTimeout(r,300)); continue; }
        const mints = extractMints(tx);
        if(!mints || mints.length===0) { await new Promise(r=>setTimeout(r,300)); continue; }
        const txBlock = (s.blockTime||s.block_time||s.blocktime)||(tx&&tx.blockTime)||null;
        const fresh = [];
        for(const m of mints){ if(['EPjFWd...','Es9vMF...'].includes(m)) continue; try{ const prev = await mintPreviouslySeen(m, txBlock, sig); if(prev===false) fresh.push(m); }catch(e){}
        }
        if(fresh.length) console.log(JSON.stringify({ program:p, signature:sig, kind, freshMints:fresh.slice(0,5), time:new Date().toISOString() }));
      }catch(e){ console.error('err',String(e)); }
      await new Promise(r=>setTimeout(r,300));
    }
    console.error(`--- done ${p} ---\n`);
  }
  console.error('All programs processed.');
})();
