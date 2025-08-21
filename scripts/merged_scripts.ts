#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();

// Merged scripts runner
// Provides subcommands: help, age-probe, fast, ws, test-recent, debug-filter, all

import { fetchDexScreenerTokens, enrichTokenTimestamps, getFirstTxTimestampFromHelius, getFirstTxTimestampFromSolscan, getFirstTxTimestampFromRpc, getField, fetchSolanaFromCoinGecko, computeFreshnessScore } from '../src/utils/tokenUtils';
import * as fastFetcher from '../src/fastTokenFetcher';
import { startHeliusWebsocketListener } from '../src/heliusWsListener';

function nowMs() { return Date.now(); }

async function computeAgeSeconds(token: any): Promise<number | null> {
  // try common fields
  const fields = ['ageSeconds','ageMinutes','age','createdAt','created_at','creation_date','created','poolOpenTime','listed_at','listedAt','genesis_date','published_at','time','timestamp','first_trade_time','baseToken.createdAt'];
  for (const f of fields) {
    const v = getField(token, f as any);
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && !isNaN(v)) {
      if (v > 1e12) return Math.floor((nowMs() - v) / 1000);
      if (v > 1e9) return Math.floor((nowMs() - v * 1000) / 1000);
      return Math.floor(Number(v) * 60);
    }
    if (typeof v === 'string') {
      const n = Number(v);
      if (!isNaN(n)) {
        if (n > 1e9) return Math.floor((nowMs() - n * 1000) / 1000);
        return Math.floor(n * 60);
      }
      const p = Date.parse(v);
      if (!isNaN(p)) return Math.floor((nowMs() - p) / 1000);
    }
  }

  const addr = token.mint || token.address || token.tokenAddress || token.pairAddress || token.token?.address || token.pair?.token?.mint || token.pair?.base?.mint || token.pair?.baseToken?.mint;
  if (!addr) return null;
  try { const h = await getFirstTxTimestampFromHelius(addr); if (h) return Math.floor((nowMs() - h) / 1000); } catch (e) {}
  try { const s = await getFirstTxTimestampFromSolscan(addr); if (s) return Math.floor((nowMs() - s) / 1000); } catch (e) {}
  try { const r = await getFirstTxTimestampFromRpc(addr); if (r) return Math.floor((nowMs() - r) / 1000); } catch (e) {}
  return null;
}

async function probeSource(name: string, fetcher: () => Promise<any[]>, maxAgeSec = 120) {
  console.log(`\n=== Source: ${name} ===`);
  try {
    const tokens = (await fetcher()) || [];
    console.log(`fetched ${tokens.length} items (preview up to 3)`);
    for (let i = 0; i < Math.min(3, tokens.length); i++) {
      console.log(JSON.stringify(tokens[i]).slice(0, 400));
    }
    const res: Array<{ addr: string; ageSec: number; token: any }> = [];
    for (const t of tokens) {
      const age = await computeAgeSeconds(t);
      const addr = (t.mint || t.address || t.tokenAddress || t.pairAddress || (t.token && (t.token.mint || t.token.address)) || 'unknown');
      if (age !== null && age <= maxAgeSec) {
        res.push({ addr, ageSec: age, token: t });
        if (res.length >= 5) break;
      }
    }
    if (res.length === 0) console.log(`No tokens < ${maxAgeSec} seconds found in this source.`);
    else {
      console.log(`Found ${res.length} tokens < ${maxAgeSec} seconds:`);
      for (const r of res) console.log(`${r.addr} -> age=${r.ageSec}s`);
    }
  } catch (e: any) {
    console.error('Error probing', name, e?.message || e);
  }
}

async function runAgeProbe() {
  await probeSource('DexScreener (profiles+pairs)', async () => {
    try { return await fetchDexScreenerTokens('solana', { limit: '80' } as any); } catch (e) { return []; }
  }, 120);

  await probeSource('Unified fetch (approx via DexScreener)', async () => {
    try { return await fetchDexScreenerTokens('solana', { limit: '80' } as any); } catch (e) { return []; }
  }, 120);

  await probeSource('CoinGecko (solana)', async () => {
    try { const cg = await fetchSolanaFromCoinGecko(); return Array.isArray(cg) ? cg : (cg ? [cg] : []); } catch (e) { return []; }
  }, 120);

  try {
    const latest = await fastFetcher.fetchLatest5FromAllSources(5);
    console.log('\n=== fastTokenFetcher.latest sets ===');
    console.log(JSON.stringify(latest, null, 2));
  } catch (e) { console.warn('fastTokenFetcher.latest failed', e); }
}

async function runFastDiscovery() {
  console.log('\n--- Running fastTokenFetcher (latest candidates) ---');
  try {
    const latest = await fastFetcher.fetchLatest5FromAllSources(10);
    console.log('Latest candidates from sources:');
    console.log(JSON.stringify(latest, null, 2));
  } catch (e) { console.error('fast discovery failed', e); }
}

async function runTestRecent() {
  console.log('Fetching DexScreener tokens (solana)...');
  const tokens = await fetchDexScreenerTokens('solana', { limit: '200' }).catch((e) => { console.error('Failed to fetch DexScreener tokens:', e?.message || e); return [] as any[]; });
  const now = Date.now();
  const recent = tokens.filter((t: any) => {
    const ageMinutes = typeof t.ageMinutes === 'number' ? t.ageMinutes : (t.poolOpenTimeMs ? (now - Number(t.poolOpenTimeMs)) / 60000 : NaN);
    return !isNaN(ageMinutes) && ageMinutes >= 0 && ageMinutes <= 5;
  }).slice(0, 5);
  if (recent.length > 0) {
    console.log(`Found ${recent.length} tokens with age 0-5 minutes (from DexScreener):`);
    console.log(JSON.stringify(recent, null, 2));
    return;
  }
  console.log('No immediate recent tokens from DexScreener. Attempting light enrichment of top candidates...');
  const candidates = tokens.slice(0, 50);
  try { await enrichTokenTimestamps(candidates, { batchSize: 6, delayMs: 200 }); } catch (e) { console.warn('Enrichment failed or timed out:', e?.message || e); }
  const post = candidates.filter((t: any) => {
    const ageMinutes = typeof t.ageMinutes === 'number' ? t.ageMinutes : (t.poolOpenTimeMs ? (now - Number(t.poolOpenTimeMs)) / 60000 : NaN);
    return !isNaN(ageMinutes) && ageMinutes >= 0 && ageMinutes <= 5;
  }).slice(0, 5);
  console.log(`After enrichment found ${post.length} tokens:`);
  console.log(JSON.stringify(post, null, 2));
}

async function runHeliusWs() {
  if (!startHeliusWebsocketListener) {
    console.error('HELIUS WS listener not available. Ensure src/heliusWsListener.ts exports startHeliusWebsocketListener');
    return;
  }
  console.log('Starting Helius WebSocket listener (press Ctrl-C to stop)');
  const instance = await startHeliusWebsocketListener({
    onOpen: () => console.log('Listener started'),
    onMessage: (m) => console.log('WS message sample:', JSON.stringify(m).slice(0, 120)),
    onClose: () => console.log('WS closed'),
    onError: (e) => console.error('WS error', e?.message || e),
  });
  process.on('SIGINT', async () => { console.log('Stopping Helius WS...'); try { await instance.stop(); } catch (e) {} process.exit(0); });
}

function printHelp() {
  console.log(`Usage: node scripts/merged_scripts.ts <command>

Commands:
  help            Show this help
  age-probe       Probe sources for tokens younger than ~2 minutes and print examples
  fast            Run fast discovery (fetchLatest5FromAllSources)
  ws              Start Helius WebSocket listener (requires HELIUS_USE_WEBSOCKET=true)
  test-recent     Fetch DexScreener and print up to 5 tokens aged 0-5 minutes
  debug-filter    Show a brief note about debug filter helper (was removed)
  all             Run age-probe then fast discovery
`);
}

async function runDebugFilter() {
  console.log('debug_filter: This helper was removed. To debug filtering, import src/bot/strategy and run filterTokensByStrategy against a sample user strategy and token list.');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  switch (cmd) {
    case 'help': printHelp(); break;
    case 'age-probe': await runAgeProbe(); break;
    case 'fast': await runFastDiscovery(); break;
    case 'ws': await runHeliusWs(); break;
    case 'test-recent': await runTestRecent(); break;
    case 'debug-filter': await runDebugFilter(); break;
    case 'all': await runAgeProbe(); await runFastDiscovery(); break;
    default: console.error('Unknown command:', cmd); printHelp(); process.exitCode = 2;
  }
}

if (require && require.main === module) {
  main().catch(e => { console.error('Error in merged scripts runner:', e); process.exit(1); });
}
