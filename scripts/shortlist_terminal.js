#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

const HELIUS_RPC = process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC || 'https://mainnet.helius-rpc.com/';
const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || '';
const LIMIT_SIGNATURES = Number(process.env.LIMIT_SIGNATURES || 500);
const PER_PROGRAM_MAX = Number(process.env.PER_PROGRAM_MAX || 5);

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

const DENY = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'So11111111111111111111111111111111111111112',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
]);

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// Minimal heliusRpc with retry/backoff
async function heliusRpc(method, params){
  const headers = Object.assign({ 'Content-Type': 'application/json' }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {});
  const maxAttempts = 3;
  for(let attempt=1; attempt<=maxAttempts; attempt++){
    try{
      const res = await axios.post(HELIUS_RPC, { jsonrpc:'2.0', id:1, method, params }, { headers, timeout:15000 });
      if(res && res.status === 429) throw new Error('rate');
      return res.data && (res.data.result || res.data);
    }catch(e){
      if(attempt===maxAttempts) return { __error: e.message || String(e) };
      await sleep(Math.min(2000, 200*Math.pow(2, attempt)) + Math.floor(Math.random()*200));
    }
  }
}

function extractMints(tx){
  const s = new Set();
  try{
    const meta = tx && (tx.meta || tx.transaction && tx.meta) || {};
    const arr = [].concat(meta.preTokenBalances||[], meta.postTokenBalances||[]);
    for(const b of arr) if(b && b.mint) s.add(b.mint);
    const inner = meta.innerInstructions || [];
    for(const block of inner) for(const ins of block.instructions||[]) try{ const pt = ins.parsed && ins.parsed.info && (ins.parsed.info.mint || ins.parsed.info.postTokenBalances); if(pt){ if(Array.isArray(pt)) for(const x of pt) if(x && x.mint) s.add(x.mint); else if(pt) s.add(pt); } }catch(e){}
  }catch(e){}
  return Array.from(s);
}

function kindOfTx(tx){
  try{
    const meta = tx && (tx.meta || tx.transaction && tx.meta) || {};
    const logs = Array.isArray(meta.logMessages)? meta.logMessages.join('\n').toLowerCase() : '';
    if(logs.includes('initializemint') || logs.includes('initialize mint') || logs.includes('instruction: initialize_mint')) return 'initialize';
    if(logs.includes('createpool') || logs.includes('initializepool') || logs.includes('create pool')) return 'pool_creation';
    if(logs.includes('instruction: swap') || logs.includes('\nprogram log: instruction: swap') || logs.includes(' swap ')) return 'swap';
    const msg = tx && (tx.transaction && tx.transaction.message) || tx.transaction || {};
    const instrs = (msg && msg.instructions) || [];
    for(const ins of instrs){
      const t = (ins.parsed && ins.parsed.type) || (ins.type || '');
      if(!t) continue;
      const lt = String(t).toLowerCase();
      if(lt.includes('initializemint') || lt.includes('initialize_mint') || lt.includes('initialize mint')) return 'initialize';
      if(lt.includes('createpool') || lt.includes('initializepool') || lt.includes('create pool')) return 'pool_creation';
      if(lt.includes('swap')) return 'swap';
    }
  }catch(e){}
  return null;
}

async function mintPreviouslySeen(mint, txBlockTime, currentSig){
  if(!mint) return true;
  try{
    const sigs = await heliusRpc('getSignaturesForAddress', [mint, { limit: 2 }]);
    if(!Array.isArray(sigs) || sigs.length===0) return false;
    for(const s of sigs){
      const sig = s.signature || s.txHash || s.sig || s.txhash;
      const bt = s.blockTime || s.block_time || s.blocktime || null;
      if(sig && sig !== currentSig && bt && txBlockTime && bt < txBlockTime) return true;
    }
    return false;
  }catch(e){ return true; }
}

(async()=>{
  console.error('Shortlist run — limits', LIMIT_SIGNATURES, PER_PROGRAM_MAX, '. Printing concise candidates to terminal.');
  for(const p of PROGRAMS){
    try{
      const sigs = await heliusRpc('getSignaturesForAddress', [p, { limit: LIMIT_SIGNATURES }]);
      if(!Array.isArray(sigs) || sigs.length===0) continue;
      let found=0;
      for(const s of sigs){
        if(found>=PER_PROGRAM_MAX) break;
        const signature = s && (s.signature || s.txHash || s.sig || s.txhash);
        if(!signature) continue;
        const tx = await heliusRpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        if(!tx || tx.__error) continue;
        const kind = kindOfTx(tx);
        if(!kind) continue;
        const mints = extractMints(tx).filter(x=>x && !DENY.has(x));
        if(mints.length===0) continue;
        // check at least one mint seems new
        const newM = [];
        for(const m of mints){
          const seenBefore = await mintPreviouslySeen(m, s.blockTime || s.block_time || s.blocktime || (tx && tx.blockTime) || null, signature);
          if(seenBefore === false) newM.push(m);
        }
        if(newM.length===0) continue;
        // print concise line
        console.log(JSON.stringify({ time: new Date().toISOString(), program: p, signature: signature, kind: kind==='initialize'?'initialize_mint':(kind==='pool_creation'?'pool_creation':'swap_with_new_mint'), newMints: newM.slice(0,5) }));
        found++;
        await sleep(120);
      }
    }catch(e){ /* continue to next program */ }
    // small pause between programs
    await sleep(300);
  }
  console.error('Shortlist run finished.');
})();
