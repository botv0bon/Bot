#!/usr/bin/env ts-node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Import utilities from original scripts
const { fetchLatest5FromAllSources, heliusGetSignaturesFast } = require('../src/fastTokenFetcher');
const { normalizeMintCandidate, getFirstOnchainTimestamp } = require('../src/utils/tokenUtils');
const { startHeliusWebsocketListener, getRecentHeliusEvents } = (() => { try { return require('../src/heliusWsListener'); } catch(e){ return {}; } })();
const config = require('../src/config');

async function runRawSourcesTest(opts: any = {}) {
  console.log('Running raw sources test (merged)...');
  // reuse logic from raw_sources_test.ts: fetch dex boosts, call fetchLatest5FromAllSources, parse-history sample, RPC getVersion, optional websocket
  try {
    const DEX_BOOSTS = process.env.DEXSCREENER_API_ENDPOINT || process.env.DEXSCREENER_API_ENDPOINT_BOOSTS || null;
    if (DEX_BOOSTS) {
      console.log('Fetching DexScreener boosts...');
      const res = await axios.get(DEX_BOOSTS, { timeout: 5000 });
      console.log('Dex boosts fetched type:', Array.isArray(res.data) ? 'array' : typeof res.data);
    } else console.log('No DexScreener boosts env');
  } catch (e: any) { console.error('Dex fetch error', e && e.message); }

  try {
    const ff = require('../src/fastTokenFetcher');
    const latestWithSources = ff && ff.fetchLatestWithSources ? await ff.fetchLatestWithSources(100) : [];
    const bySource: Record<string, string[]> = {};
    for (const it of latestWithSources) { bySource[it.source] = bySource[it.source] || []; bySource[it.source].push(it.mint); }
    console.log('Source breakdown:');
    for (const k of Object.keys(bySource)) console.log(`- ${k}: ${bySource[k].length}`);
    console.log('Sample per source (first 5 each):');
    for (const k of Object.keys(bySource)) console.log(k, bySource[k].slice(0,5));
    // Optional validation via Helius RPC to ensure account exists
    const shouldValidate = (process.env.HELIUS_VALIDATE_ACCOUNTS || 'false').toLowerCase() === 'true';
    if (shouldValidate) {
      console.log('HELIUS_VALIDATE_ACCOUNTS=true -> validating accounts via helius getAccountInfo (concurrency from HELIUS_VALIDATE_CONCURRENCY)');
      const ff = require('../src/fastTokenFetcher');
      const getAccountInfo = ff && ff.getAccountInfo;
      if (typeof getAccountInfo !== 'function') {
        console.warn('getAccountInfo not available from fastTokenFetcher; skipping validation');
      } else {
  const allMints: string[] = Array.from(new Set(latestWithSources.map((x:any)=>String(x.mint))));
        const concurrency = Number(process.env.HELIUS_VALIDATE_CONCURRENCY || 3);
        let idx = 0;
  const valid: string[] = [];
  const invalid: string[] = [];
        async function worker() {
          while (idx < allMints.length) {
            const i = idx++;
            const m = allMints[i];
            try {
              const acct: any = await getAccountInfo(m).catch(() => null);
              if (acct && (acct as any).value) valid.push(String(m));
              else invalid.push(String(m));
            } catch (e) { invalid.push(String(m)); }
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, allMints.length) }, () => worker()));
        console.log(`Validation complete: valid=${valid.length} invalid=${invalid.length}`);
        console.log('Valid sample:', valid.slice(0,10));
        if (invalid.length) console.log('Invalid sample:', invalid.slice(0,10));
      }
    }
  } catch (e:any) { console.error('fastTokenFetcher error', e && e.message); }
}

async function runTestHoney() {
  console.log('Running test_honey (merged)...');
  try {
    const users: any = { u1: { secret: 'invalid-secret', wallet: '11111111111111111111111111111111', strategy: { minAge: 0 } } };
    const { executeHoneyStrategy, setHoneySettings } = require('../userStrategy');
    setHoneySettings('u1', { repeatOnEntry: false, tokens: [{ address: 'So11111111111111111111111111111111111111112', buyAmount: 0.01, profitPercents: [10], soldPercents: [50,50] }] }, users);
    const getPrice = async (addr: string) => 1;
    const autoBuy = async (addr: string, amount: number, secret: string) => 'tx-buy-mock';
    const autoSell = async (addr: string, amount: number, secret: string) => 'tx-sell-mock';
    await executeHoneyStrategy('u1', users, getPrice, autoBuy, autoSell);
    console.log('executeHoneyStrategy finished');
  } catch (e:any) { console.error('test_honey error', e && e.message); }
}

async function runLatestAgeFilter() {
  console.log('Running latest age filter (merged)...');
  try {
    const latest = await fetchLatest5FromAllSources(50);
  const all = new Set<string>();
  for (const arr of [latest.heliusEvents || [], latest.dexTop || [], latest.heliusHistory || []]) for (const m of arr) all.add(m);
  // normalize candidates to canonical solana mints
  const normalized = Array.from(all).map(m => normalizeMintCandidate(m)).filter(Boolean) as string[];
  const candidates = normalized.slice(0, 50);
  console.log('candidates (normalized):', candidates.length);
  const heliusUrl = config.HELIUS_RPC_URL || process.env.HELIUS_FAST_RPC_URL || process.env.HELIUS_RPC_URL || '';
    if (!heliusUrl) { console.error('No Helius URL'); return; }
    const now = Math.floor(Date.now()/1000);
    const results: any[] = [];
    for (const m of candidates) {
      try {
        // Use unified first-onchain helper which returns earliest timestamp in ms
        const res = await (getFirstOnchainTimestamp ? getFirstOnchainTimestamp(m, { timeoutMs: 2500 }) : Promise.resolve({ ts: null }));
        if (res && res.ts) {
          const firstMs = Number(res.ts);
          const ageSec = Math.floor((Date.now() - firstMs) / 1000);
          results.push({ mint: m, firstBlockTime: Math.floor(firstMs / 1000), ageSec, source: res.source || 'first-onchain' });
          continue;
        }
        results.push({ mint: m, error: 'no-first-ts' });
      } catch (e:any) {
        results.push({ mint: m, error: String(e && e.message || e) });
      }
    }
    const fresh = results.filter(r => typeof r.ageSec === 'number' && r.ageSec >=0 && r.ageSec <= 300);
    console.log(`Found ${fresh.length} tokens aged 0-5 minutes:`);
    fresh.forEach(f => console.log('-', f.mint, 'ageSec=', f.ageSec));
  } catch (e:any) { console.error('latest age filter error', e && e.message); }
}

async function runCollectWsEvents(durationSec = 20) {
  console.log('Running WS collector (merged) for', durationSec, 'seconds');
  try {
    if (!startHeliusWebsocketListener) { console.error('heliusWsListener.start not available'); return; }
    const inst = await startHeliusWebsocketListener({ onOpen: ()=>console.log('WS open'), onMessage: (m:any)=>{} });
    await new Promise(r=>setTimeout(r, durationSec*1000));
    const events = getRecentHeliusEvents ? getRecentHeliusEvents() : [];
    console.log('Collected events:', (events||[]).length);
  } catch (e:any) { console.error('collect ws events error', e && e.message); }
}



async function runFindFresh(limitCandidates = 200, want = 5) {
  console.log(`Running find-fresh: limitCandidates=${limitCandidates} want=${want}`);
  const ff = require('../src/fastTokenFetcher');
  if (!ff || !ff.fetchLatestWithSources) {
    console.error('fastTokenFetcher.fetchLatestWithSources not available');
    return;
  }
  const heliusUrl = config.HELIUS_RPC_URL || process.env.HELIUS_FAST_RPC_URL || process.env.HELIUS_RPC_URL || '';
  if (!heliusUrl) { console.error('No Helius URL configured'); return; }

  // 1) gather candidates from all sources
  const candWithSource: any[] = await ff.fetchLatestWithSources(limitCandidates);
  const unique = Array.from(new Set(candWithSource.map((c:any)=>String(c.mint)))) as string[];

  // optional validation
  const shouldValidate = (process.env.HELIUS_VALIDATE_ACCOUNTS || 'false').toLowerCase() === 'true';
  let candidates: string[] = unique;
  if (shouldValidate && ff.getAccountInfo) {
    console.log('Validating candidate accounts before on-chain lookups...');
    const concurrency = Number(process.env.HELIUS_VALIDATE_CONCURRENCY || 6);
    const valid: string[] = [];
    let idx = 0;
    async function worker() {
      while (idx < unique.length) {
        const i = idx++;
        const m = String(unique[i]);
        try {
          const acct: any = await ff.getAccountInfo(m).catch(()=>null);
          if (acct && acct.value) valid.push(m);
        } catch (e) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
    candidates = valid;
    console.log(`Validation result: ${candidates.length}/${unique.length} valid`);
  }


    // 2) for each candidate, query unified first-tx timestamp helper (limited concurrency)
    const timeoutMs = Number(process.env.FIND_FRESH_TIMEOUT_MS || 3000);
    const concurrency = Number(process.env.FIND_FRESH_CONCURRENCY || 8);
    const results: Array<{ mint: string; firstBlockTimeMs?: number; ageSeconds?: number; error?: string }> = [];
    let ptr = 0;
    const tu = require('../src/utils/tokenUtils');
    const checkOnChainActivity = tu && (tu.checkOnChainActivity || tu.getFirstTxTimestampFromHelius);
    async function workerFetch() {
      while (ptr < candidates.length && results.length < want * 10) {
        const i = ptr++;
        const m = candidates[i];
        try {
          if (!checkOnChainActivity) {
            results.push({ mint: m, error: 'no-onchain-helper' });
            continue;
          }
          // checkOnChainActivity returns { firstTxMs, found } or similar; fall back to getFirstTxTimestampFromHelius if not present
          let firstMs: number | null = null;
          try {
            const maybe = await (tu.checkOnChainActivity ? tu.checkOnChainActivity(m) : tu.getFirstTxTimestampFromHelius(m));
            if (maybe) {
              if (typeof maybe === 'object') {
                firstMs = maybe.firstTxMs ?? maybe.firstTxMillis ?? maybe.firstTxMs ?? maybe.firstBlockTime ?? maybe.firstBlockTimeMs ?? null;
              } else if (typeof maybe === 'number') {
                firstMs = maybe;
              }
            }
          } catch (e:any) {
            // If helper throws, record and continue
            results.push({ mint: m, error: String(e && e.message || e) });
            continue;
          }
          if (!firstMs) { results.push({ mint: m, error: 'no-first-tx' }); continue; }
          const now = Date.now();
          const age = Math.floor((now - Number(firstMs)) / 1000);
          results.push({ mint: m, firstBlockTimeMs: Number(firstMs), ageSeconds: age });
        } catch (e:any) {
          results.push({ mint: m, error: String(e && e.message || e) });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, candidates.length)) }, () => workerFetch()));

  // 3) filter by age 0-300s and sort ascending (most recent first small age)
  const fresh = results.filter(r => typeof r.ageSeconds === 'number' && r.ageSeconds >= 0 && r.ageSeconds <= 300).sort((a,b)=> (a.ageSeconds! - b.ageSeconds!)).slice(0, want);
  console.log(`Found ${fresh.length} tokens aged 0-5 minutes:`);
  fresh.forEach(f => console.log('-', f.mint, 'ageSec=', f.ageSeconds));
  if (fresh.length === 0) console.log('No fresh tokens found in the candidate set. Consider increasing limitCandidates or timeout.');
}

async function runWsMerge(durationSec = 20) {
  console.log('Running WS merge: Helius WS + Solana logs for', durationSec, 'seconds');
  const events: any[] = [];
  // start Helius WS listener (if available)
  let heliusInstance: any = null;
  try {
    if (startHeliusWebsocketListener) {
      heliusInstance = await startHeliusWebsocketListener({
        onOpen: () => console.log('Helius WS open'),
        onMessage: (m: any) => {
          try { events.push({ source: 'hel', raw: m, ts: Date.now() }); } catch (e) {}
        },
        onClose: () => console.log('Helius WS closed'),
        onError: (e: any) => console.warn('Helius WS error', e && e.message)
      });
    } else {
      console.log('startHeliusWebsocketListener not available');
    }
  } catch (e: any) {
    console.warn('Failed to start Helius WS:', e && e.message);
  }

  // start Solana logs subscription using shared connection
  const tu = require('../src/utils/tokenUtils');
  const normalize = tu && tu.normalizeMintCandidate ? tu.normalizeMintCandidate : (s: any) => null;
  let solSubId: number | null = null;
  try {
    const conn = config.connection;
    if (conn && typeof conn.onLogs === 'function') {
      solSubId = conn.onLogs('all', (logs: any, ctx: any) => {
        try { events.push({ source: 'sol', raw: logs, ctx, ts: Date.now() }); } catch (e) {}
      }, 'confirmed');
      console.log('Solana logs subscription started id=', solSubId);
    } else {
      console.log('No Solana connection.onLogs available in config.connection');
    }
  } catch (e: any) {
    console.warn('Failed to subscribe to Solana logs:', e && e.message);
  }

  // collect for duration
  await new Promise((res) => setTimeout(res, Math.max(1000, Number(durationSec) * 1000)));

  // stop subscriptions
  try { if (heliusInstance && heliusInstance.stop) await heliusInstance.stop(); } catch (e) {}
  try {
    if (solSubId && config && config.connection && typeof config.connection.removeOnLogsListener === 'function') {
      try { config.connection.removeOnLogsListener(solSubId); } catch (e) { /* ignore */ }
    }
  } catch (e) {}

  // normalize and dedupe detected mints
  const seen = new Set<string>();
  const unified: Array<{ mint: string; source: string; ts: number }> = [];
  for (const ev of events) {
    try {
      let cand: string | null = null;
      // try common paths
      cand = normalize(ev.raw?.mint || ev.raw?.parsed?.info?.mint || ev.raw?.params?.result?.value?.meta?.postTokenBalances?.[0]?.mint || ev.raw?.params?.result?.value?.meta?.logMessages?.join('\n') || ev.raw?.logs?.join ? (ev.raw.logs || []).join('\n') : JSON.stringify(ev.raw));
      if (!cand) {
        // fallback: attempt to extract base58-like substring
        const s = JSON.stringify(ev.raw || '');
        const m = s.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
        if (m && m.length) cand = normalize(m[0]);
      }
      if (cand && !seen.has(cand)) {
        seen.add(cand);
        unified.push({ mint: cand, source: ev.source || 'unknown', ts: ev.ts || Date.now() });
      }
    } catch (e) {}
  }

  // enrich with first-onchain timestamp (best-effort, short timeout)
  const enrichTu = require('../src/utils/tokenUtils');
  for (const u of unified) {
    try {
      const res = await enrichTu.getFirstOnchainTimestamp(u.mint, { timeoutMs: 3000 });
      (u as any).firstTs = res.ts || null;
      (u as any).sourceTs = res.source || null;
      (u as any).ageMinutes = res.ts ? Math.floor((Date.now() - res.ts) / 60000) : null;
    } catch (e) {
      (u as any).firstTs = null;
      (u as any).ageMinutes = null;
    }
  }

  console.log('\nWS-merge summary: events=', events.length, 'unique_mints=', unified.length);
  if (unified.length === 0) console.log('No unified mints detected.');
  else {
    console.log('Unified mints (sample):');
    for (const u of unified.slice(0, 50)) console.log(JSON.stringify(u));
  }
}

async function main() {
  const cmd = process.argv[2] || 'help';
  if (cmd === 'raw') await runRawSourcesTest();
  else if (cmd === 'honey') await runTestHoney();
  else if (cmd === 'age') await runLatestAgeFilter();
  else if (cmd === 'collect') await runCollectWsEvents(Number(process.argv[3] || 20));
  else if (cmd === 'wsmerge') {
    const duration = Number(process.argv[3] || 20);
    console.log('Running wsmerge for', duration, 'seconds');
    // start helius ws listener if available
    const events: Array<any> = [];
    try {
      if (startHeliusWebsocketListener) {
        const inst = await startHeliusWebsocketListener({ onOpen: ()=>console.log('Helius WS open'), onMessage: (m:any)=>{ try { const a = (m && (m.mint || m.params?.result?.value?.meta?.postTokenBalances || m.params?.result)); events.push({ source: 'helius-ws', raw: m }); } catch(e){} } });
        // also collect recent events helper
        try { const getRecent = getRecentHeliusEvents; if (getRecent) { const recent = getRecent(); recent.forEach((r:any)=> events.push({ source: 'helius-ws-recent', raw: r })); } } catch(e){}
        // stop after duration
        setTimeout(async () => { try { await inst.stop(); } catch{} }, duration * 1000);
      } else console.log('Helius WS listener not available');
    } catch (e) { console.error('Failed to start Helius WS:', e && e.message); }

    // start Solana RPC websocket to collect logsSubscribe events
    try {
      const WS = (await import('ws')).default || (await import('ws'));
      const solWsUrl = process.env.RPC_WEBSOCKET_ENDPOINT || process.env.HELIUS_WEBSOCKET_URL || '';
      if (solWsUrl) {
        const sock = new WS(solWsUrl, { handshakeTimeout: 5000 } as any);
        let sid = 1;
        const subs: Record<number,string> = {};
        sock.on('open', () => {
          console.log('Solana RPC WS connected');
          try {
            // subscribe to SPL Token program logs and Metadata program
            const METADATA = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
            const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
            const send = (method:string, params:any, tag:string) => { const id = sid++; subs[id] = tag; sock.send(JSON.stringify({ jsonrpc:'2.0', id, method, params })); };
            send('logsSubscribe', [{ mentions: [METADATA] }, { commitment: 'confirmed' }], 'metadata');
            send('logsSubscribe', [{ mentions: [SPL] }, { commitment: 'confirmed' }], 'spl-token');
          } catch(e){}
        });
        sock.on('message', (m:any) => {
          try {
            const parsed = typeof m === 'string' ? JSON.parse(m) : JSON.parse(m.toString());
            events.push({ source: 'sol-ws', raw: parsed });
          } catch (e) {}
        });
        sock.on('error', (e:any)=> console.warn('Sol WS error', e && e.message));
        setTimeout(()=>{ try { sock.close(); } catch{} }, duration * 1000 + 1000);
      } else console.log('No RPC_WEBSOCKET_ENDPOINT configured');
    } catch (e) { console.error('Failed to start Solana WS:', e && e.message); }

    // wait duration, then process events quickly with normalization and enrichment
    await new Promise(r => setTimeout(r, Math.max(2000, duration * 1000)));
    console.log('Collected events:', events.length);
    // normalize mints
    const tu = require('../src/utils/tokenUtils');
    const normalize = tu.normalizeMintCandidate || ((s:any)=>s);
    const uniq = new Set<string>();
    for (const ev of events) {
      try {
        // try various paths
        const raw = ev.raw || ev;
        const cand = raw.mint || raw.params?.result?.value?.meta?.postTokenBalances?.[0]?.mint || raw.params?.result?.value?.transaction?.message?.instructions?.map((i:any)=>i.parsed?.info?.mint).find(Boolean) || null;
        const n = normalize(String(cand || ''));
        if (n) uniq.add(n);
      } catch (e) {}
    }
    const list = Array.from(uniq).slice(0, 200);
    console.log('Normalized unique mints found:', list.length);
    const out: any[] = [];
    for (const m of list) {
      try {
        const res = await tu.getFirstOnchainTimestamp(m, { timeoutMs: 4000 });
        const ageMin = res.ts ? Math.floor((Date.now() - res.ts)/60000) : null;
        out.push({ mint: m, ageMin, source: res.source, cached: res.cached });
      } catch (e) { out.push({ mint: m, error: String(e) }); }
    }
    console.log('Unified results:');
    for (const o of out) console.log(JSON.stringify(o));
  }
  else if (cmd === 'wsmerge') await runWsMerge(Number(process.argv[3] || 20));
  else if (cmd === 'fresh') await runFindFresh(Number(process.argv[3] || 200), Number(process.argv[4] || 5));
  else if (cmd === 'all') {
    // ensure logs dir
    const outdir = path.join(process.cwd(), 'logs');
    try { fs.mkdirSync(outdir, { recursive: true }); } catch {}
    const logfile = path.join(outdir, `merged_run_${Date.now()}.log`);
    const append = (s: string) => { try { fs.appendFileSync(logfile, s + '\n'); } catch (e) {} };
    append('=== MERGED RUN START ' + new Date().toISOString() + ' ===');
    try { append('\n-- RAW --'); await runRawSourcesTest(); append('RAW OK'); } catch (e:any) { append('RAW ERR: ' + (e && e.message)); }
    try { append('\n-- HONEY --'); await runTestHoney(); append('HONEY OK'); } catch (e:any) { append('HONEY ERR: ' + (e && e.message)); }
    try { append('\n-- AGE --'); await runLatestAgeFilter(); append('AGE OK'); } catch (e:any) { append('AGE ERR: ' + (e && e.message)); }
    try { append('\n-- COLLECT (5s) --'); await runCollectWsEvents(5); append('COLLECT OK'); } catch (e:any) { append('COLLECT ERR: ' + (e && e.message)); }
    append('=== MERGED RUN END ' + new Date().toISOString() + ' ===');
    console.log('Merged run finished; log:', logfile);
  }
  else console.log('Usage: ts-node scripts/merged_scripts.ts <raw|honey|age|collect|wsmerge|fresh|all>');
}

main().then(()=>console.log('Merged script finished')).catch(e=>{ console.error('Merged fatal', e && e.message); process.exit(1); });
