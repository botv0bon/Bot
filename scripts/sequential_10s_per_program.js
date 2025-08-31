#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

// Helius RPC configuration: support rotating API keys and RPC URLs to reduce pressure
// Provide comma-separated lists in env: HELIUS_API_KEYS and HELIUS_RPC_URLS
const _HELIUS_KEYS = (process.env.HELIUS_API_KEYS || process.env.HELIUS_API_KEY || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
const HELIUS_RPC_URLS = (process.env.HELIUS_RPC_URLS || process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
// Fallback to single default when none provided
if(_HELIUS_KEYS.length===0){ const k = process.env.HELIUS_API_KEY || ''; if(k) _HELIUS_KEYS.push(k); }
if(HELIUS_RPC_URLS.length===0){ HELIUS_RPC_URLS.push('https://mainnet.helius-rpc.com/'); }
// internal counter for round-robin
let heliusCallCounter = 0;
// Basic validation: detect obvious placeholder keys/urls to help debugging when no mints appear
function looksLikePlaceholderKey(k){ if(!k) return true; const up = String(k).toUpperCase(); if(up.includes('KEY1')||up.includes('KEY2')||up.includes('KEY')||up.includes('XXX')||up.includes('PLACEHOLDER')) return true; return false; }
function looksLikeUrl(u){ try{ return String(u).toLowerCase().startsWith('http'); }catch(e){ return false; } }
const badKeys = _HELIUS_KEYS.filter(looksLikePlaceholderKey);
const badUrls = HELIUS_RPC_URLS.filter(u => !looksLikeUrl(u));
if(badKeys.length > 0 || badUrls.length > 0){
  console.error('Helius configuration validation failed: please set real API keys and valid RPC URLs via environment variables.');
  if(badKeys.length>0) console.error('  Detected placeholder-ish HELIUS_API_KEYS:', JSON.stringify(_HELIUS_KEYS));
  if(badUrls.length>0) console.error('  Detected invalid HELIUS_RPC_URLS:', JSON.stringify(HELIUS_RPC_URLS));
  console.error('Example (bash):');
  console.error('  HELIUS_API_KEYS="yourKey1,yourKey2" HELIUS_RPC_URLS="https://mainnet.helius-rpc.com/,https://rpc2.example/" node scripts/sequential_10s_per_program.js');
  // fail fast so user notices configuration issue instead of silent RPC errors
  process.exit(1);
}
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
// EventEmitter for in-process notification handling
const notifier = new EventEmitter();
// export notifier when required as a module
try{ module.exports = module.exports || {}; module.exports.notifier = notifier; }catch(e){}

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

// Configurable timings (ms) via environment variables
const PER_PROGRAM_DURATION_MS = Number(process.env.PER_PROGRAM_DURATION_MS) || 10000;
const INNER_SLEEP_MS = Number(process.env.INNER_SLEEP_MS) || 120;
const POLL_SLEEP_MS = Number(process.env.POLL_SLEEP_MS) || 250;
const CYCLE_SLEEP_MS = Number(process.env.CYCLE_SLEEP_MS) || 2000;
const SIG_BATCH_LIMIT = Number(process.env.SIG_BATCH_LIMIT) || 5;
const MINT_SIG_LIMIT = Number(process.env.MINT_SIG_LIMIT) || 3;

// Simple RPC statistics for diagnostics
const RPC_STATS = { calls: 0, errors: 0, rateLimit429: 0, totalLatencyMs: 0 };

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// heliusRpc(method, params, useEnrich=false)
// when useEnrich=true the call uses the second Helius key / URL for enrichment work
async function heliusRpc(method, params){
  RPC_STATS.calls++;
  const start = Date.now();
  // choose key and url round-robin
  try{
    const keyIdx = heliusCallCounter % Math.max(1, _HELIUS_KEYS.length);
    const urlIdx = heliusCallCounter % Math.max(1, HELIUS_RPC_URLS.length);
    heliusCallCounter = (heliusCallCounter + 1) >>> 0;
    const url = HELIUS_RPC_URLS[urlIdx];
    const hdrs = Object.assign({ 'Content-Type': 'application/json' }, _HELIUS_KEYS[keyIdx] ? { 'x-api-key': _HELIUS_KEYS[keyIdx] } : {});
    const res = await axios.post(url, { jsonrpc:'2.0', id:1, method, params }, { headers: hdrs, timeout:15000 });
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

// Common helius getTransaction options
const HELIUS_TX_OPTS = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 };

// Utility: normalize signature field from different shapes
function getSig(entry){
  if(!entry) return null;
  return entry.signature || entry.txHash || entry.sig || entry.txhash || null;
}

// Utility: safely join tx log messages to a lowercase string
function joinTxLogs(tx){
  try{
    const logs = (tx && tx.meta && Array.isArray(tx.meta.logMessages)) ? tx.meta.logMessages : [];
    return logs.join('\n').toLowerCase();
  }catch(e){ return ''; }
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

// Heuristic: confirm that a mint was created/initialized in this transaction
function isMintCreatedInThisTx(tx, mint){
  try{
    if(!tx) return false;
    const logs = joinTxLogs(tx);
    const m = String(mint).toLowerCase();
    // common log markers
    if(logs.includes('instruction: initializemint') || logs.includes('initialize mint') || logs.includes('initialize_mint') || logs.includes('createidempotent')) return true;
    // sometimes log messages include the mint address when created
    if(m && logs.includes(m)) return true;
    // inspect parsed instructions for initialize mint
    const msg = tx && (tx.transaction && tx.transaction.message) || tx.transaction || {};
    const instrs = (msg && msg.instructions) || [];
    for(const ins of instrs){
      try{
        const t = (ins.parsed && ins.parsed.type) || (ins.type || '');
        if(t && String(t).toLowerCase().includes('initializemint')) return true;
        const info = ins.parsed && ins.parsed.info;
        if(info){
          if(info.mint && String(info.mint).toLowerCase() === m) return true;
          if(info.newAccount && String(info.newAccount).toLowerCase() === m) return true;
        }
      }catch(e){}
    }
  }catch(e){}
  return false;
}

async function mintPreviouslySeen(mint, txBlockTime, currentSig){
  if(!mint) return true;
  try{
    // reduced limit to lower RPC cost; configurable via MINT_SIG_LIMIT
    const sigs = await heliusRpc('getSignaturesForAddress', [mint, { limit: MINT_SIG_LIMIT }]);
    if(!Array.isArray(sigs) || sigs.length===0) return false;
    for(const s of sigs){
      try{ const sig = getSig(s); const bt = s.blockTime||s.block_time||s.blocktime||null; if(sig && sig!==currentSig && bt && txBlockTime && bt < txBlockTime) return true; }catch(e){}
    }
    return false;
  }catch(e){ return true; }
}

async function startSequentialListener(options){
  console.error('Sequential 10s per-program listener starting (daemon mode)');
  const seenMints = new Set();
  let stopped = false;
  process.on('SIGINT', () => { console.error('SIGINT received, stopping listener...'); stopped = true; });
  // Load and cache users once; watch file for changes to avoid reading on every match
  const usersPath = path.join(process.cwd(), 'users.json');
  let users = {};
  const loadUsers = () => {
    try{ const usersRaw = fs.readFileSync(usersPath, 'utf8'); users = usersRaw ? JSON.parse(usersRaw) : {}; }catch(e){ users = {}; }
  };
  loadUsers();
  try{ fs.watchFile(usersPath, { interval: 2000 }, () => { loadUsers(); console.error('users.json reloaded'); }); }catch(e){}
  // require strategy filter once to avoid repeated module resolution cost
  let strategyFilter = null;
  try{ strategyFilter = require('../src/bot/strategy').filterTokensByStrategy; }catch(e){ strategyFilter = null; }
  // Try to load fastTokenFetcher utilities for canonical/enriched candidate data
  let fastFetcher = null;
  try { fastFetcher = require('../dist/src/fastTokenFetcher'); } catch (e) { try { fastFetcher = require('../src/fastTokenFetcher'); } catch (ee) { fastFetcher = null; } }
  // DEX-only enrichment mode: controllable via env var DEX_ONLY (set to 'false' to disable DEX enrichment)
  const DEX_ONLY = (process.env.DEX_ONLY || 'true').toString().toLowerCase() !== 'false';

  // DEX sources allowed (comma-separated in .env, e.g. DEX_SOURCES=raydium,solfi,pammbay)
  const DEX_SOURCES = (String(process.env.DEX_SOURCES || '')).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const TARGET_MINTS = Number(process.env.TARGET_MINTS) || 4; // how many distinct minted tokens to gather then exit
  const dexResults = [];

  // Pretty-print current dexResults to terminal (compact summary + JSON)
  function printDexResultsSummary() {
    try{
      // compact JSON array
      console.log('\n=== DEX RESULTS SUMMARY ===');
      try{ console.log(JSON.stringify({ dexChannel: dexResults }, null, 2)); }catch(e){ console.log(JSON.stringify({ dexChannel: dexResults })); }
      // friendly per-mint lines
      for(const r of dexResults){
        try{
          const m = (r && r.mint) || 'unknown';
          const prog = (r && r.program) || 'unknown';
          const sig = (r && r.signature) || '';
          const dex = (r && r.dex && r.dex.dex) || (r && r.dex) || {};
          const liq = dex && (dex.liquidity !== undefined ? dex.liquidity : (dex && dex.tvl)) || null;
          const vol = dex && (dex.volume !== undefined ? dex.volume : null) || null;
          console.log(`- ${m}  | program=${prog} | sig=${sig}`);
          console.log(`  Liquidity: ${liq === null ? 'N/A' : liq} | Volume: ${vol === null ? 'N/A' : vol}`);
        }catch(e){ }
      }
      console.log('=== END DEX RESULTS SUMMARY ===\n');
    }catch(e){ /* ignore printing errors */ }
  }

  // Dexscreener fallback: try token-pairs endpoint first, then search endpoint
  async function fetchDexscreenerForMint(mint){
    if(!mint) return null;
    const tokenPairsBase = (process.env.DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS || 'https://api.dexscreener.com/token-pairs/v1/solana').replace(/\/$/, '');
    const searchBase = (process.env.DEXSCREENER_API_ENDPOINT_SEARCH || 'https://api.dexscreener.com/latest/dex/search?q=').replace(/\/$/, '');
    const axiosOpts = { timeout: 8000 };
    try{
      // try token-pairs endpoint
      const tpUrl = `${tokenPairsBase}/${mint}`;
      try{
        const r = await axios.get(tpUrl, axiosOpts);
        const d = r && r.data;
        const pairs = d && (d.pairs || d.pair || (Array.isArray(d) ? d : null));
        if(Array.isArray(pairs) && pairs.length>0){
          const first = pairs[0];
          const liquidity = first.liquidityUsd || first.liquidity || first.tvl || null;
          const volume = first.volumeUsd || first.volume || first.volume_24h || null;
          return { liquidity: liquidity || null, volume: volume || null, raw: d };
        }
        if(d && (d.liquidityUsd || d.volumeUsd || d.tvl)){
          return { liquidity: d.liquidityUsd || d.tvl || null, volume: d.volumeUsd || d.volume || null, raw: d };
        }
      }catch(e){ /* ignore token-pairs errors */ }

      // fallback: search endpoint
      try{
        const q = encodeURIComponent(mint);
        const sUrl = `${searchBase}${q}`;
        const r2 = await axios.get(sUrl, axiosOpts);
        const sd = r2 && r2.data;
        const items = sd && (sd.pairs || sd.results || sd.tokens || sd.pairsList || null) || sd;
        if(Array.isArray(items) && items.length>0){
          for(const it of items){
            const liquidity = it.liquidityUsd || it.liquidity || it.tvl || (it.pair && (it.pair.liquidityUsd || it.pair.tvl)) || null;
            const volume = it.volumeUsd || it.volume || it.volume_24h || (it.pair && (it.pair.volumeUsd || it.pair.volume)) || null;
            if(liquidity || volume) return { liquidity: liquidity || null, volume: volume || null, raw: it };
          }
          return { liquidity: null, volume: null, raw: items[0] };
        }
        if(sd && (sd.liquidityUsd || sd.volumeUsd)) return { liquidity: sd.liquidityUsd||null, volume: sd.volumeUsd||null, raw: sd };
      }catch(e){ /* ignore search errors */ }
    }catch(e){ }
    return null;
  }

  // Local DEX enrichment helper (single-file). Uses fastFetcher if available to get DEX/pool/liquidity info.
  // sourceHint: program id (protocol) that produced the mint — prefer pools matching it
  async function dexEnrichForMint(mintAddr, sourceHint){
    if(!mintAddr) return { ok:false, error:'no_mint' };
    if(fastFetcher && typeof fastFetcher.handleNewMintEventCached === 'function'){
      try{
        // try with limited retries/backoff in case of transient 429 errors
        let det = null;
        for(let attempt=1; attempt<=3; attempt++){
          try{
            det = await fastFetcher.handleNewMintEventCached(mintAddr, 60).catch(()=>null);
            break;
          }catch(e){
            const msg = String(e && (e.message||e.response&&e.response.status) || e);
            if(msg && msg.includes('429')){
              // backoff and retry
              await sleep(200 * Math.pow(2, attempt-1));
              continue;
            }
            break;
          }
        }
        // normalize a compact dex-focused result
        // filter pools by allowed DEX_SOURCES when provided
        let pools = det && (det.pools || det.pairs || det.dex || null) || null;
        if (pools && Array.isArray(pools) && DEX_SOURCES.length > 0) {
          pools = pools.filter(p => {
            try{
              // discover several possible fields that indicate pool source or program
              const src = (p.source || p.provider || p.sourceName || p.dex || '').toString().toLowerCase();
              const prog = (p.program || p.programId || p.owner || p.ammProgram || '').toString().toLowerCase();
              if (sourceHint && sourceHint.toString()){
                const sh = sourceHint.toString().toLowerCase();
                if(prog && prog.includes(sh)) return true;
                if(src && src.includes(sh)) return true;
              }
              if (!src) return false;
              return DEX_SOURCES.includes(src) || DEX_SOURCES.some(ds => src.includes(ds));
            }catch(e){ return false; }
          });
        }
        const dex = {
          mint: mintAddr,
          found: !!(det && (det.firstBlockTime || (pools && pools.length>0) || det.liquidity)),
          firstBlockTime: det && det.firstBlockTime || null,
          liquidity: (det && (det.liquidity || det.tvl || det.dexLiquidity)) || null,
          pools: pools,
          canonical: det || null
        };
        // If no pools found and user provided DEX_SOURCES, attempt a local log-based probe using Helius
        if((!dex.found || !dex.pools || dex.pools.length===0) && DEX_SOURCES.length>0){
          try{
            const sigs = await heliusRpc('getSignaturesForAddress', [mintAddr, { limit: 3 }]);
            if(Array.isArray(sigs) && sigs.length>0){
              for(const s0 of sigs){
                try{
                  const sSig = getSig(s0);
                  if(!sSig) continue;
                  const tx = await heliusRpc('getTransaction', [sSig, HELIUS_TX_OPTS]);
                  const logs = (tx && tx.meta && Array.isArray(tx.meta.logMessages))? tx.meta.logMessages.join('\n').toLowerCase() : '';
                  // prefer matches that mention the sourceHint (program id) first
                  if(sourceHint && logs.includes(String(sourceHint).toLowerCase())){
                    const matches = (tx && tx.meta && tx.meta.logMessages) || [];
                    const pool = { source: String(sourceHint), signature: sSig, sampleLogs: matches.slice(0,10) };
                    dex.found = true;
                    dex.pools = dex.pools && dex.pools.length? dex.pools.concat([pool]) : [pool];
                    if(!dex.firstBlockTime) dex.firstBlockTime = s0.blockTime || s0.block_time || null;
                    try{ if((dex.liquidity===null || dex.liquidity===undefined)){ const ds = await fetchDexscreenerForMint(mintAddr); if(ds){ dex.liquidity = ds.liquidity || null; dex.volume = ds.volume || null; dex.canonical = Object.assign({}, dex.canonical || {}, { dexscreener: ds.raw }); } } }catch(e){}
                    return { ok:true, dex };
                  }
                  for(const ds of DEX_SOURCES){
                    if(logs.includes(ds)){
                      const matches = (tx && tx.meta && tx.meta.logMessages) || [];
                      const pool = { source: ds, signature: sSig, sampleLogs: matches.slice(0,10) };
                      dex.found = true;
                      dex.pools = dex.pools && dex.pools.length? dex.pools.concat([pool]) : [pool];
                      if(!dex.firstBlockTime) dex.firstBlockTime = s0.blockTime || s0.block_time || null;
                      try{ if((dex.liquidity===null || dex.liquidity===undefined)){ const ds = await fetchDexscreenerForMint(mintAddr); if(ds){ dex.liquidity = ds.liquidity || null; dex.volume = ds.volume || null; dex.canonical = Object.assign({}, dex.canonical || {}, { dexscreener: ds.raw }); } } }catch(e){}
                      return { ok:true, dex };
                    }
                  }
                }catch(e){ /* ignore per-signature probe errors */ }
              }
            }
          }catch(e){ /* ignore local probe errors */ }
        }
  try{ if((dex.liquidity===null || dex.liquidity===undefined) && dex.found){ const dsAll = await fetchDexscreenerForMint(mintAddr); if(dsAll){ dex.liquidity = dex.liquidity || dsAll.liquidity || null; dex.volume = dsAll.volume || null; dex.canonical = Object.assign({}, dex.canonical || {}, { dexscreener: dsAll.raw }); } } }catch(e){}
  return { ok:true, dex };
      }catch(e){ return { ok:false, error: String(e && e.message || e) }; }
    }
    // No fastFetcher available: fallback: try a lightweight local probe via Helius to detect DEX mentions in tx logs
    try{
      if(DEX_SOURCES.length>0){
  const sigs = await heliusRpc('getSignaturesForAddress', [mintAddr, { limit: 3 }]);
        if(Array.isArray(sigs) && sigs.length>0){
          for(const s0 of sigs){
            try{
              const sSig = s0 && (s0.signature||s0.txHash||s0.sig||s0.txhash);
              if(!sSig) continue;
              const tx = await heliusRpc('getTransaction', [sSig, HELIUS_TX_OPTS]);
              const logs = (tx && tx.meta && tx.meta.logMessages) ? tx.meta.logMessages.join('\n').toLowerCase() : '';
              // prefer sourceHint matches
              if(sourceHint && logs.includes(String(sourceHint).toLowerCase())){
                const matches = (tx && tx.meta && tx.meta.logMessages) || [];
                const pool = { source: String(sourceHint), signature: sSig, sampleLogs: matches.slice(0,10) };
                const dex = { mint: mintAddr, found: true, firstBlockTime: s0.blockTime||s0.block_time||null, liquidity: null, pools: [pool], canonical: null };
                try{ const dsLocal = await fetchDexscreenerForMint(mintAddr); if(dsLocal){ dex.liquidity = dsLocal.liquidity || null; dex.volume = dsLocal.volume || null; dex.canonical = Object.assign({}, dex.canonical || {}, { dexscreener: dsLocal.raw }); } }catch(e){}
                return { ok:true, dex };
              }
              for(const ds of DEX_SOURCES){
                if(logs.includes(ds)){
                  const matches = (tx && tx.meta && tx.meta.logMessages) || [];
                  const pool = { source: ds, signature: sSig, sampleLogs: matches.slice(0,10) };
                  const dex = { mint: mintAddr, found: true, firstBlockTime: s0.blockTime||s0.block_time||null, liquidity: null, pools: [pool], canonical: null };
                  try{ const dsLocal2 = await fetchDexscreenerForMint(mintAddr); if(dsLocal2){ dex.liquidity = dsLocal2.liquidity || null; dex.volume = dsLocal2.volume || null; dex.canonical = Object.assign({}, dex.canonical || {}, { dexscreener: dsLocal2.raw }); } }catch(e){}
                  return { ok:true, dex };
                }
              }
            }catch(e){}
          }
        }
      }
    }catch(e){}
    return { ok:false, error:'no_fast_fetcher' };
  }
  // track last signature per program to avoid reprocessing the same tx repeatedly
  const lastSigPerProgram = new Map();
  while(!stopped){
    for(const p of PROGRAMS){
      if (stopped) break;
      try{
        const rule = RULES[p] || RULES.default;
        console.error(`[${p}] listening (10s)`);
        const end = Date.now()+10000;
        const seenTxs = new Set();
    while(Date.now()<end){
          if (stopped) break;
          try{
            if(!rule || !Array.isArray(rule.allow) || rule.allow.length===0) break;
      // fetch a small batch of recent signatures to process any new ones
      const sigs = await heliusRpc('getSignaturesForAddress', [p, { limit: SIG_BATCH_LIMIT }]);
            if(!Array.isArray(sigs)||sigs.length===0){ await sleep(250); continue; }
            // process newest first
            let s = sigs[0];
            // find the first unseen signature in the batch
            for(const cand of sigs){
              const candSig = cand && (cand.signature||cand.txHash||cand.sig||cand.txhash);
              if(!candSig) continue;
              if(seenTxs.has(candSig)) continue;
              // also skip if we've already processed this program's latest sig earlier
              if(lastSigPerProgram.get(p) === candSig) { continue; }
              s = cand; break;
            }
            if(!s) { await sleep(POLL_SLEEP_MS); continue; }
            const sig = getSig(s); if(!sig) { await sleep(250); continue; }
            if(seenTxs.has(sig)) { await sleep(POLL_SLEEP_MS); continue; } seenTxs.add(sig);
            lastSigPerProgram.set(p, sig);
            const tx = await heliusRpc('getTransaction', [sig, HELIUS_TX_OPTS]);
            if(!tx || tx.__error) { await sleep(250); continue; }
            const kind = txKindExplicit(tx); if(!kind) { await sleep(250); continue; }
            if(!rule.allow.includes(kind)) { await sleep(250); continue; }
            const mints = extractMints(tx).filter(x=>x && !DENY.has(x)); if(mints.length===0) { await sleep(250); continue; }
            const fresh = [];
            const txBlock = (s.blockTime||s.block_time||s.blocktime)||(tx&&tx.blockTime)||null;
            for(const m of mints){
              try{
                if(seenMints.has(m)) continue;
                // Strict check: confirm the mint's first signature equals this tx signature
                let accept = false;
                try{
                  const firstSigs = await heliusRpc('getSignaturesForAddress', [m, { limit: 1 }]);
                  if(Array.isArray(firstSigs) && firstSigs.length>0){
                    const firstSig = getSig(firstSigs[0]);
                    if(firstSig && firstSig === sig) accept = true;
                  }
                }catch(e){}
                // If signature probe failed, fall back to log-based created-in-this-tx heuristic and previous seen check
                if(!accept){
                  const createdHere = isMintCreatedInThisTx(tx, m);
                  if(!createdHere) continue;
                  const prev = await mintPreviouslySeen(m, txBlock, sig);
                  if(prev===false) accept = true;
                }
                if(accept) fresh.push(m);
              }catch(e){}
            }
            // Print up to 2 newest discovered fresh mints immediately to terminal with color
            try{
              if(Array.isArray(fresh) && fresh.length>0){
                const latest = fresh.slice(0,2);
                // header (plain)
                console.log(`FRESH_MINTS [program=${p}] [sig=${sig}] [kind=${kind}]`);
                // colored JSON for the array (yellow)
                try{
                  console.log('\x1b[33m%s\x1b[0m', JSON.stringify(latest, null, 2));
                }catch(e){ console.log('\x1b[33m%s\x1b[0m', String(latest)); }
              }
            }catch(e){}
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
        if(!referencesFresh){ await sleep(POLL_SLEEP_MS); continue; }
              }catch(e){}
            }
            for(const m of fresh) seenMints.add(m);
            if (DEX_ONLY) {
              // DEX-only flow: enrich only the first fresh mint via dexEnrichForMint and emit that result
              const firstMint = fresh[0];
              try{
                const dexRes = await dexEnrichForMint(firstMint);
                const dexEvent = { time: new Date().toISOString(), program: p, signature: sig, kind: kind, mint: firstMint, dex: dexRes };
                // push into dexResults array and emit to dexChannel
                try{ dexResults.push(dexEvent); }catch(e){}
                try{ notifier.emit('dexChannel', dexEvent); }catch(e){}
                // Also write the raw dexEvent to an append-only ndjson channel for external consumers
                try{
                  const outDir = path.join(process.cwd(), 'out');
                  try{ fs.mkdirSync(outDir, { recursive: true }); } catch(e){}
                  const channelFile = path.join(outDir, 'dex_channel.ndjson');
                  try{ fs.appendFileSync(channelFile, JSON.stringify(dexEvent) + '\n', 'utf8'); } catch(e){}
                }catch(e){}
                // Start background rotation enrichment using provided DEX_SOURCES and/or dexRes canonical info
                (async function backgroundEnrich(evt){
                  try{
                    // collect candidate source hints: prefer explicit DEX_SOURCES from env, else try canonical pools/programs
                    const hints = Array.isArray(DEX_SOURCES) && DEX_SOURCES.length>0 ? DEX_SOURCES.slice() : [];
                    try{
                      const canonical = evt && evt.dex && evt.dex.dex && evt.dex.dex.canonical;
                      if(canonical){
                        // try to extract probable sources from canonical (pools/providers/program)
                        try{
                          const p = canonical.program || canonical.programId || canonical.owner || canonical.source || canonical.provider || null;
                          if(p) hints.push(String(p).toLowerCase());
                        }catch(e){}
                        try{
                          if(Array.isArray(canonical.pools)) for(const pp of canonical.pools){ if(pp && (pp.source||pp.provider||pp.program)) hints.push(String(pp.source||pp.provider||pp.program).toLowerCase()); }
                        }catch(e){}
                      }
                    }catch(e){}
                    // de-duplicate hints while preserving order
                    const seenHints = new Set();
                    const uniqHints = [];
                    for(const h of hints){ try{ if(!h) continue; const s = String(h).toLowerCase(); if(!seenHints.has(s)){ seenHints.add(s); uniqHints.push(s); } }catch(e){} }
                    // If no hints, add a fallback null attempt to run general dexscreener probe
                    if(uniqHints.length===0) uniqHints.push(null);
                    // Iterate hints with small delays to avoid immediate rate-limiting
                    for(const hint of uniqHints){
                      try{
                        await sleep(150 * (Math.random()*3 + 1));
                        const res = await dexEnrichForMint(evt.mint, hint);
                        // append enrichment result to channel file
                        try{
                          const outDir2 = path.join(process.cwd(), 'out');
                          const channelFile2 = path.join(outDir2, 'dex_channel.ndjson');
                          const enriched = { time: new Date().toISOString(), program: evt.program, signature: evt.signature, mint: evt.mint, hint: hint, enrichment: res };
                          try{ fs.appendFileSync(channelFile2, JSON.stringify(enriched) + '\n', 'utf8'); } catch(e){}
                        }catch(e){}
                        // if enrichment found pools/liq, stop further attempts for this event
                        try{ if(res && res.ok && res.dex && res.dex.found) break; }catch(e){}
                      }catch(e){}
                    }
                  }catch(e){}
                })(dexEvent).catch(()=>{});
                // print the new event (keep per-event output). Avoid printing the full summary every push
                console.log(JSON.stringify(dexEvent));
                // mark seen only when DEX found enrichment to avoid reprocessing
                try{ if(dexRes && dexRes.ok && dexRes.dex && dexRes.dex.found) seenMints.add(firstMint); }catch(e){}
                // if we've collected enough distinct DEX results, stop the whole listener and print summary
                try{
                  if (dexResults.length >= TARGET_MINTS) {
                    console.error('TARGET_MINTS reached', dexResults.length);
                    // Print a single final summary and stop
                    try{ printDexResultsSummary(); }catch(e){}
                    stopped = true;
                    break;
                  }
                }catch(e){}
              }catch(e){ console.error('DEX_ENRICH_ERROR', String(e && e.message || e)); }
            } else {
              // Emit global event for listeners
      const globalEvent = { time:new Date().toISOString(), program:p, signature:sig, kind: kind, freshMints:fresh.slice(0,5), sampleLogs:(tx.meta&&tx.meta.logMessages||[]).slice(0,6) };
                // If requested, perform immediate raw enrichment for fresh mints (on this file only)
                const doRaw = String(process.env.PRINT_RAW_FRESH || '').toLowerCase() === 'true';
                if (doRaw) {
                  try{
                    const rawResults = [];
                    for(const fm of (fresh.slice(0,5))) {
                      try{
                        const acct = await heliusRpc('getAccountInfo', [fm, { encoding: 'base64' }]);
                        const sigs = await heliusRpc('getSignaturesForAddress', [fm, { limit: 5 }]);
                        let tx0 = null;
                        try{
                          if(Array.isArray(sigs) && sigs.length>0){ const s0 = sigs[0]; const sSig = getSig(s0); if(sSig) tx0 = await heliusRpc('getTransaction', [sSig, HELIUS_TX_OPTS]); }
                        }catch(e){}
                        rawResults.push({ mint: fm, account: acct, signatures: Array.isArray(sigs)?sigs:sigs, sampleFirstTx: tx0 });
                      }catch(e){ rawResults.push({ mint: fm, __error: String(e && e.message || e) }); }
                    }
                    globalEvent.rawEnrich = rawResults;
                  }catch(e){ /* ignore raw enrich errors */ }
                }
                console.log(JSON.stringify(globalEvent));
      // emit program-level event
      try{ notifier.emit('programEvent', globalEvent); }catch(e){}
            }
            // Also evaluate per-user strategies (if any) and emit per-user matches
            try{
              const strategyFilterLocal = strategyFilter; // cached above
              const usersLocal = users || {};
              // Build token objects from fresh mints for filtering
              // Lightweight on-chain enrichment: fetch the first signature for each mint to derive a first-tx timestamp (cheap, 1 RPC per mint)
                const candidateTokens = await Promise.all(fresh.map(async (m) => {
                const mintAddr = m;
                // include listener source metadata so strategy filters can preserve/inspect realtime origin
                const tok = { address: mintAddr, tokenAddress: mintAddr, mint: mintAddr, sourceProgram: p, sourceSignature: sig, sampleLogs: (tx.meta&&tx.meta.logMessages||[]).slice(0,10), sourceCandidates: true };
                try{
                  // Prefer fastTokenFetcher enrichment if available to get canonical age, liquidity, sources
                  if (fastFetcher && typeof fastFetcher.handleNewMintEventCached === 'function') {
                    try{
                      const det = await fastFetcher.handleNewMintEventCached(mintAddr, 60).catch(() => null);
                      if (det) {
                        if (det.firstBlockTime) {
                          try { tok.freshnessDetails = { firstTxMs: Number(det.firstBlockTime) * 1000 }; } catch(e){}
                          try { tok._canonicalAgeSeconds = (Date.now() - (Number(det.firstBlockTime) * 1000)) / 1000; } catch(e){}
                        }
                        if (det.metadataExists !== undefined) tok.metadataExists = det.metadataExists;
                        if (det.supply !== undefined) tok.supply = det.supply;
                      }
                    }catch(e){}
                    try{
                      const cache = (fastFetcher.getGlobalFetchCache && fastFetcher.getGlobalFetchCache()) || [];
                      const found = cache.find(c => String((c.tokenAddress||c.address||c.mint||'')).toLowerCase() === String(mintAddr).toLowerCase());
                      if (found) tok = Object.assign({}, found, tok);
                    }catch(e){}
                  } else {
                    // fallback: cheap on-chain first-signature probe
                    try{
                      const sigs = await heliusRpc('getSignaturesForAddress', [mintAddr, { limit: 1 }]);
                      if (Array.isArray(sigs) && sigs.length > 0) {
                        const s0 = sigs[0];
                        const bt = s0.blockTime || s0.block_time || s0.blocktime || null;
                        if (bt) {
                          try { tok.freshnessDetails = { firstTxMs: Number(bt) * 1000 }; } catch(e){}
                          try { tok._canonicalAgeSeconds = (Date.now() - (Number(bt) * 1000)) / 1000; } catch(e){}
                        }
                      }
                    }catch(e){}
                  }
                }catch(e){}
                return tok;
              }));
        for(const uid of Object.keys(usersLocal || {})){
                try{
          const user = usersLocal[uid];
                  if(!user || !user.strategy || user.strategy.enabled === false) continue;
          // run the filter (allow enrichment inside strategy filter for accuracy)
      if(!strategyFilterLocal) continue;
          // If the user's numeric strategy fields are all zero/undefined, treat this user
          // as a listener-only user: accept listener-provided candidateTokens directly
          // (no conditions, no enrichment). Otherwise run the normal strategy filter.
          let matched = [];
          try{
            const numericKeys = ['minMarketCap','minLiquidity','minVolume','minAge'];
            const hasNumericConstraint = numericKeys.some(k => {
              const v = user.strategy && user.strategy[k];
              return v !== undefined && v !== null && Number(v) > 0;
            });
            if(!hasNumericConstraint){
              // listener-only: accept raw listener tokens as matches (limit to maxTrades)
              const maxTrades = Number(user.strategy && user.strategy.maxTrades ? user.strategy.maxTrades : 3) || 3;
              matched = (Array.isArray(candidateTokens) ? candidateTokens.slice(0, maxTrades) : []);
              try{ console.error(`MATCH (listener-bypass) user=${uid} matched=${matched.map(t=>t.address||t.tokenAddress||t.mint).slice(0,5)}`); }catch(e){}
            } else {
              // default: run the robust strategy filter (may enrich)
              // DEBUG: print per-candidate diagnostics so we can see why tokens are rejected
              try{
                const tu = require('../src/utils/tokenUtils');
                for(const tok of candidateTokens){
                  try{
                    const pre = tu.autoFilterTokensVerbose([tok], user.strategy);
                    const preCount = Array.isArray(pre) ? (pre.length) : (pre && pre.passed ? (pre.passed.length||0) : 0);
                    const willPass = await strategyFilterLocal([tok], user.strategy, { preserveSources: true }).then(r=> Array.isArray(r) && r.length>0).catch(()=>false);
                    try{ console.error(`STRATEGY_DEBUG user=${uid} token=${tok && (tok.tokenAddress||tok.address||tok.mint)} preCandidates=${preCount} pass=${willPass} age=${tok && (tok._canonicalAgeSeconds || (tok.freshnessDetails && tok.freshnessDetails.firstTxMs)) || 'n/a'} sampleLogs=${(tok && tok.sampleLogs? (tok.sampleLogs||[]).slice(0,3).join('|') : '')}`); }catch(e){}
                  }catch(e){}
                }
              }catch(e){}
              matched = await strategyFilterLocal(candidateTokens, user.strategy, { preserveSources: true }).catch(() => []);
            }
          }catch(e){ matched = []; }
                  if(Array.isArray(matched) && matched.length > 0){
                    const matchAddrs = matched.map(t => t.address || t.tokenAddress || t.mint).slice(0,5);
                    const userEvent = { time:new Date().toISOString(), program:p, signature:sig, user: uid, matched: matchAddrs, kind: kind, candidateTokens: candidateTokens.slice(0,10) };
                    // Detailed log for matches
                    console.error('MATCH', JSON.stringify(userEvent));
                    // Emit notification event (in-process) and also write a backup notification file
                    try{ notifier.emit('notification', userEvent); }catch(e){}
                    // Optional backup: write notifications to disk for external consumers when enabled
                    const writeBackup = (process.env.NOTIFY_WRITE_BACKUP === undefined) ? true : (String(process.env.NOTIFY_WRITE_BACKUP) !== 'false');
                    if (writeBackup) {
                      try{
                        const outDir = path.join(process.cwd(), 'out');
                        try{ fs.mkdirSync(outDir, { recursive: true }); } catch(e){}
                        const notifDir = path.join(outDir, 'notifications');
                        try{ fs.mkdirSync(notifDir, { recursive: true }); } catch(e){}
                        const fileName = Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.json';
                        const filePath = path.join(notifDir, fileName);
                        fs.writeFileSync(filePath, JSON.stringify(userEvent, null, 2), 'utf8');
                      }catch(e){}
                    }
                    // Optional Redis enqueue for faster consumption when REDIS_URL is set (kept for external consumers)
                    if (process.env.REDIS_URL) {
                      try {
                        const IORedis = require('ioredis');
                        const r = new IORedis(process.env.REDIS_URL);
                        await r.lpush('notifications', JSON.stringify(userEvent));
                        r.disconnect();
                      } catch (re) { /* ignore redis errors */ }
                    }
                  }
                }catch(e){ /* per-user errors shouldn't break main loop */ }
              }
            }catch(e){}
          }catch(e){ }
          await sleep(120);
        }
        console.error(`[${p}] done`);
      }catch(e){ console.error(`[${p}] err ${String(e)}`); }
    }
    // Print RPC stats summary per full cycle
    try{
      const avg = RPC_STATS.calls ? Math.round(RPC_STATS.totalLatencyMs / RPC_STATS.calls) : 0;
      console.error('RPC_STATS', JSON.stringify({ calls: RPC_STATS.calls, errors: RPC_STATS.errors, rateLimit429: RPC_STATS.rateLimit429, avgLatencyMs: avg }));
    }catch(e){}
    // short delay between cycles to avoid tight looping
    try { await sleep(2000); } catch (e) { }
  }
  console.error('Sequential 10s per-program listener stopped');
}

module.exports.startSequentialListener = startSequentialListener;
// If script is executed directly, run immediately (CLI usage preserved)
if (require.main === module) {
  startSequentialListener().catch(e => { console.error('Listener failed:', e && e.message || e); process.exit(1); });
}