// run_age_probe.ts removed — legacy test helper. No-op stub.
console.log('run_age_probe.ts removed — no-op stub');

import { fetchDexScreenerTokens, fetchSolanaFromCoinGecko, getFirstTxTimestampFromHelius, getFirstTxTimestampFromSolscan, getFirstTxTimestampFromRpc, getField } from '../src/utils/tokenUtils';

function nowMs() { return Date.now(); }

async function computeAgeSeconds(token: any): Promise<number | null> {
  // try common fields
  const fields = ['ageSeconds','ageMinutes','age','createdAt','created_at','creation_date','created','poolOpenTime','listed_at','listedAt','genesis_date','published_at','time','timestamp','first_trade_time','baseToken.createdAt'];
  for (const f of fields) {
    const v = getField(token, f as any);
    if (v === undefined || v === null) continue;
    // if number
    if (typeof v === 'number' && !isNaN(v)) {
      if (v > 1e12) return Math.floor((nowMs() - v) / 1000);
      if (v > 1e9) return Math.floor((nowMs() - v * 1000) / 1000);
      // treat as minutes
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

  // fallback: try on-chain timestamp from helius/solscan/rpc using token address/mint
  const addr = token.mint || token.address || token.tokenAddress || token.pairAddress || token.token?.address || token.pair?.token?.mint || token.pair?.base?.mint || token.pair?.baseToken?.mint;
  if (!addr) return null;
  // try Helius
  try {
    const h = await getFirstTxTimestampFromHelius(addr);
    if (h) return Math.floor((nowMs() - h) / 1000);
  } catch (e) {}
  try {
    const s = await getFirstTxTimestampFromSolscan(addr);
    if (s) return Math.floor((nowMs() - s) / 1000);
  } catch (e) {}
  try {
    const r = await getFirstTxTimestampFromRpc(addr);
    if (r) return Math.floor((nowMs() - r) / 1000);
  } catch (e) {}

  return null;
}

async function probeSource(name: string, fetcher: () => Promise<any[]>) {
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
      if (age !== null && age <= 120) {
        res.push({ addr, ageSec: age, token: t });
        if (res.length >= 5) break;
      }
    }
    if (res.length === 0) console.log('No tokens < 2 minutes found in this source.');
    else {
      console.log(`Found ${res.length} tokens < 2 minutes:`);
      for (const r of res) console.log(`${r.addr} -> age=${r.ageSec}s`);
    }
  } catch (e: any) {
    console.error('Error probing', name, e?.message || e);
  }
}

async function main() {
  // DexScreener tokens
  await probeSource('DexScreener (profiles+pairs)', async () => {
    try { return await fetchDexScreenerTokens('solana', { limit: '80' } as any); } catch (e) { return []; }
  });

  // Unified tokens (heavy) - use fetchDexScreenerTokens as best-available unified source
  await probeSource('Unified fetch (approx via DexScreener)', async () => {
    try {
      return await fetchDexScreenerTokens('solana', { limit: '80' } as any);
    } catch (e) { return []; }
  });

  // CoinGecko
  await probeSource('CoinGecko (solana)', async () => {
    try { const cg = await fetchSolanaFromCoinGecko(); return Array.isArray(cg) ? cg : (cg ? [cg] : []); } catch (e) { return []; }
  });

  // FastTokenFetcher latest 5 from all sources (helius events/dexTop/helisHistory)
  try {
  const f = await import('../src/fastTokenFetcher');
    const latest = await f.fetchLatest5FromAllSources(5);
    console.log('\n=== fastTokenFetcher.latest sets ===');
    console.log(JSON.stringify(latest, null, 2));
  } catch (e) {}
}

main().catch(e => { console.error(e); process.exit(1); });
