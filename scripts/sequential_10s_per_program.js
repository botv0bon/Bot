#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

const HELIUS_RPC = process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC || 'https://mainnet.helius-rpc.com/';
const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || '';
const headers = Object.assign({ 'Content-Type': 'application/json' }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {});

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

const RULES = {
  default: { allow: ['initialize','pool_creation'] },
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': { allow: ['initialize'] },
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': { allow: [] },
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { allow: ['pool_creation','swap'] },
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': { allow: ['pool_creation','swap'] },
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': { allow: ['pool_creation','swap'] },
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': { allow: ['swap'] },
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': { allow: ['swap'] },
  '11111111111111111111111111111111': { allow: ['swap'] },
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin': { allow: ['pool_creation','initialize','swap'] },
  '9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp': { allow: [] },
  'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu': { allow: ['swap'] }
};

const DENY = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB','So11111111111111111111111111111111111111112','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']);

// Simple RPC statistics for diagnostics
const RPC_STATS = { calls: 0, errors: 0, rateLimit429: 0, totalLatencyMs: 0 };

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function heliusRpc(method, params){
  RPC_STATS.calls++;
  const start = Date.now();
  try{
    const res = await axios.post(HELIUS_RPC, { jsonrpc:'2.0', id:1, method, params }, { headers, timeout:15000 });
    const latency = Date.now() - start; RPC_STATS.totalLatencyMs += latency;
    if(res && res.status === 429) RPC_STATS.rateLimit429++;
    return res.data && (res.data.result || res.data);
  }catch(e){
    const status = e.response && e.response.status;
    if(status === 429) RPC_STATS.rateLimit429++;
    RPC_STATS.errors++;
    return { __error: (e.response && e.response.statusText) || e.message, status };
  }
}

function extractMints(tx){
  const s = new Set();
  try{
    const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {};
    const arr = [].concat(meta.preTokenBalances||[], meta.postTokenBalances||[]);
    for(const b of arr) if(b && b.mint) s.add(b.mint);
    const inner = meta.innerInstructions || [];
    for(const block of inner){
      const instrs = block && block.instructions || [];
      for(const ins of instrs){
        try{
          const pt = ins && ins.parsed && ins.parsed.info && (ins.parsed.info.mint || ins.parsed.info.postTokenBalances);
          if(pt){ if(Array.isArray(pt)) for(const x of pt) if(x && x.mint) s.add(x.mint); else if(pt) s.add(pt); }
        }catch(e){}
      }
    }
  }catch(e){}
  return Array.from(s);
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
  return null;
}

async function mintPreviouslySeen(mint, txBlockTime, currentSig){
  if(!mint) return true;
  try{
    const sigs = await heliusRpc('getSignaturesForAddress', [mint, { limit: 10 }]);
    if(!Array.isArray(sigs) || sigs.length===0) return false;
    for(const s of sigs){
      try{ const sig = s.signature||s.txHash||s.sig||s.txhash; const bt = s.blockTime||s.block_time||s.blocktime||null; if(sig && sig!==currentSig && bt && txBlockTime && bt < txBlockTime) return true; }catch(e){}
    }
    return false;
  }catch(e){ return true; }
}

(async()=>{
  console.error('Sequential 10s per-program listener starting');
  const seenMints = new Set();
  for(const p of PROGRAMS){
    try{
      const rule = RULES[p] || RULES.default;
      console.error(`[${p}] listening (10s)`);
      const end = Date.now()+10000;
      const seenTxs = new Set();
      while(Date.now()<end){
        try{
          if(!rule || !Array.isArray(rule.allow) || rule.allow.length===0) break;
          const sigs = await heliusRpc('getSignaturesForAddress', [p, { limit: 1 }]);
          if(!Array.isArray(sigs)||sigs.length===0){ await sleep(250); continue; }
          const s = sigs[0]; if(!s) { await sleep(250); continue; }
          const sig = s.signature||s.txHash||s.sig||s.txhash; if(!sig) { await sleep(250); continue; }
          if(seenTxs.has(sig)) { await sleep(250); continue; } seenTxs.add(sig);
          const tx = await heliusRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
          if(!tx || tx.__error) { await sleep(250); continue; }
          const kind = txKindExplicit(tx); if(!kind) { await sleep(250); continue; }
          if(!rule.allow.includes(kind)) { await sleep(250); continue; }
          const mints = extractMints(tx).filter(x=>x && !DENY.has(x)); if(mints.length===0) { await sleep(250); continue; }
          const fresh = [];
          const txBlock = (s.blockTime||s.block_time||s.blocktime)||(tx&&tx.blockTime)||null;
          for(const m of mints){ if(seenMints.has(m)) continue; const prev = await mintPreviouslySeen(m, txBlock, sig); if(prev===false) fresh.push(m); }
          if(fresh.length===0) { await sleep(250); continue; }
          if(kind==='swap'){
            // Tightened rule: require an explicit parsed instruction reference
            // (info.mint / info.source / info.destination) to match a fresh mint.
            try{
              const msg = tx && (tx.transaction && tx.transaction.message) || tx.transaction || {};
              const instrs = (msg && msg.instructions) || [];
              let referencesFresh = false;
              for(const ins of instrs){
                try{
                  const info = ins.parsed && ins.parsed.info;
                  if(info){
                    if(info.mint && fresh.includes(info.mint)) referencesFresh = true;
                    if(info.source && fresh.includes(info.source)) referencesFresh = true;
                    if(info.destination && fresh.includes(info.destination)) referencesFresh = true;
                  }
                }catch(e){}
              }
              if(!referencesFresh){ await sleep(250); continue; }
            }catch(e){}
          }
          for(const m of fresh) seenMints.add(m);
          console.log(JSON.stringify({ time:new Date().toISOString(), program:p, signature:sig, kind: kind, freshMints:fresh.slice(0,5), sampleLogs:(tx.meta&&tx.meta.logMessages||[]).slice(0,6) }));
        }catch(e){ }
        await sleep(120);
      }
      console.error(`[${p}] done`);
    }catch(e){ console.error(`[${p}] err ${String(e)}`); }
  }
  // Print RPC stats summary
  try{
    const avg = RPC_STATS.calls ? Math.round(RPC_STATS.totalLatencyMs / RPC_STATS.calls) : 0;
    console.error('RPC_STATS', JSON.stringify({ calls: RPC_STATS.calls, errors: RPC_STATS.errors, rateLimit429: RPC_STATS.rateLimit429, avgLatencyMs: avg }));
  }catch(e){}
  console.error('Sequential 10s per-program listener finished');
})();
