import { fetchAndFilterTokensForUsers, getGlobalFetchCache, runDeepCacheCheck } from '../src/fastTokenFetcher';

async function main() {
  console.log('Starting age-check run (warmup=5000ms, detail=true)');
  try {
    const users = {}; // empty users map to only populate global cache
    const res = await fetchAndFilterTokensForUsers(users as any, { limit: 200, force: true, detail: true, warmupHeliusMs: 5000 });
    console.log('fetchAndFilterTokensForUsers returned. sample per-user keys:', Object.keys(res).slice(0,5));
    const cache = getGlobalFetchCache() || [];
    console.log('Global cache size:', cache.length);
    for (const c of cache.slice(0, 10)) {
      console.log(JSON.stringify({ addr: c.tokenAddress || c.address || c.mint, _canonicalAgeSeconds: c._canonicalAgeSeconds, firstBlockTime: c.firstBlockTime || c.poolOpenTimeMs || null, sources: (c.__sources || []).slice(0,3) }, null, 2));
    }
  } catch (e) {
    console.error('error running fetchAndFilterTokensForUsers', e && (e as any).message ? (e as any).message : e);
  }

  console.log('\nNow running runDeepCacheCheck(windowMin=5, limit=200)');
  try {
    await runDeepCacheCheck({ windowMin: 5, limit: 200 });
    console.log('runDeepCacheCheck completed');
  } catch (e) {
    console.error('runDeepCacheCheck failed', e && (e as any).message ? (e as any).message : e);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });
