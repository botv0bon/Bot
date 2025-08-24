import { fetchAndFilterTokensForUsers, analyzeFetchSources, getGlobalFetchCache } from '../src/fastTokenFetcher';

(async () => {
  try {
    console.log('Starting diagnostic: populating global fetch cache (force=true) with Helius warm-up 8000ms ...');
    await fetchAndFilterTokensForUsers({}, { limit: 200, force: true, warmupHeliusMs: 8000 });
    const analysis = analyzeFetchSources();
    console.log('\n=== Source Analysis ===');
    console.log('totalTokens:', analysis.totalTokens);
    console.log('distinctSources:', analysis.distinctSources);
    console.log('\nPer-token source counts (sample up to 10):');
    for (const p of (analysis.perTokenCounts || []).slice(0, 10)) {
      console.log(`- ${p.addr} -> sources=${p.sourceCount} [${(p.sources || []).slice(0,3).join(', ')}]`);
    }

    const cache = getGlobalFetchCache() || [];
    console.log('\n=== Sample cached token objects (up to 5) ===');
  for (const c of cache.slice(0,5)) console.log(JSON.stringify({ address: c.tokenAddress || c.address || c.mint, _canonicalAgeSeconds: c._canonicalAgeSeconds, __sources: c.__sources || c.__meta || null, sample: { marketCap: c.marketCap, liquidity: c.liquidity, priceUsd: c.priceUsd } }, null, 2));

    console.log('\nDiagnostic done.');
    process.exit(0);
  } catch (e) {
    console.error('Diagnostic failed:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
