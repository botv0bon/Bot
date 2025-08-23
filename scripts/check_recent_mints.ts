import { fetchLatest5FromAllSources } from '../src/fastTokenFetcher';
import { getFirstOnchainTimestamp } from '../src/utils/tokenUtils';

async function main() {
  console.log('Collecting latest candidates from multiple sources...');
  const res = await fetchLatest5FromAllSources(50);
  const all = new Set<string>();
  for (const k of ['heliusEvents', 'dexTop', 'heliusHistory'] as const) {
    const arr = (res as any)[k] || [];
    for (const a of arr) {
      if (a) all.add(a);
    }
  }
  const list = Array.from(all);
  console.log(`Found ${list.length} unique candidate mints.`);
  const out: any[] = [];
  for (const m of list) {
    try {
      const ts = await getFirstOnchainTimestamp(m, { timeoutMs: 60000 });
      const now = Date.now();
      const firstMs = ts.ts || null;
      const ageMinutes = firstMs ? Math.floor((now - firstMs) / 60000) : null;
      out.push({ mint: m, firstMs, ageMinutes, source: ts.source });
    } catch (e) {
      out.push({ mint: m, error: String(e) });
    }
  }
  console.log('All candidates with computed ages:');
  for (const o of out) console.log(JSON.stringify(o));
  const recent = out.filter(x => typeof x.ageMinutes === 'number' && x.ageMinutes <= 5);
  console.log('\nFiltered: ageMinutes <= 5');
  for (const r of recent) console.log(JSON.stringify(r));
}

main().catch(e => { console.error(e); process.exit(1); });
