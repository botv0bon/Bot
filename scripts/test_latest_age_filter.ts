import { fetchLatest5FromAllSources, heliusGetSignaturesFast, handleNewMintEvent } from '../src/fastTokenFetcher';
import axios from 'axios';

async function run() {
  console.log('Fetching latest candidates from multiple sources...');
  const latest = await fetchLatest5FromAllSources(50);
  console.log('Sources sizes:', Object.fromEntries(Object.entries(latest).map(([k,v]) => [k, Array.isArray(v) ? v.length : 0])));

  const all = new Set<string>();
  for (const arr of [latest.heliusEvents || [], latest.dexTop || [], latest.heliusHistory || []]) {
    for (const m of arr) all.add(m);
  }
  const candidates = Array.from(all).slice(0, 50);
  console.log('Total unique candidates:', candidates.length);

  const heliusUrl = process.env.HELIUS_FAST_RPC_URL || process.env.HELIUS_RPC_URL || '';
  if (!heliusUrl) {
    console.error('No Helius URL configured. Set HELIUS_FAST_RPC_URL or HELIUS_RPC_URL to run on-chain age checks.');
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const results: any[] = [];

  for (const m of candidates) {
    const r = await heliusGetSignaturesFast(m, heliusUrl, 2500, 0).catch(e => ({ __error: String(e) }));
    if (!r || (r as any).__error) {
      results.push({ mint: m, error: (r as any).__error || 'no-data' });
      continue;
    }
    const arr = Array.isArray(r) ? r : ((r as any).result ?? r);
    if (!arr || !arr.length) { results.push({ mint: m, error: 'no-sigs' }); continue; }
    // compute earliest blockTime
    let earliest: number | null = null;
    for (const e of arr) {
      const bt = e?.blockTime ?? e?.block_time ?? e?.timestamp ?? null;
      if (!bt) continue;
      const bts = bt > 1e12 ? Math.floor(bt / 1000) : bt;
      if (!earliest || bts < earliest) earliest = bts;
    }
    if (!earliest) { results.push({ mint: m, error: 'no-blocktime' }); continue; }
    const ageSec = now - earliest;
    results.push({ mint: m, firstBlockTime: earliest, ageSec });
  }

  // filter 0..5 minutes (0-300s)
  const fresh = results.filter(r => r.ageSec !== undefined && typeof r.ageSec === 'number' && r.ageSec >= 0 && r.ageSec <= 300);
  console.log(`Found ${fresh.length} tokens aged 0-5 minutes:`);
  for (const f of fresh) {
    console.log(`- ${f.mint} ageSec=${f.ageSec}`);
  }

  // Suggest improvements based on observed counts
  console.log('\nObservations & quick suggestions:');
  console.log('- If the number of fresh tokens is 0, increase fetch sources or sample size.');
  console.log('- If many candidates have no signatures, consider raising dexTop sampling or using Helius parse-history URL.');
  console.log('- Consider caching signature lookups and using lightweight on-chain-activity checks before heavy enrich.');
}

run().catch(e => { console.error(e); process.exit(1); });
