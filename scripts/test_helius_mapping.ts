(async () => {
  const ff = require('../src/fastTokenFetcher');
  const hw = require('../src/heliusWsListener');
  // Create a fake recent events buffer by starting ws listener and then mocking getRecentHeliusEvents
  // Simpler: call getRecentHeliusEvents() and ensure function doesn't throw and mapping preserves shapes
  try {
    const evs = hw.getRecentHeliusEvents ? hw.getRecentHeliusEvents() : [];
    console.log('sample helius buffer size:', Array.isArray(evs) ? evs.length : 0);
    const res = await ff.getUnifiedCandidates(5);
    console.log('getUnifiedCandidates sample:', JSON.stringify(res.slice(0,5), null, 2));
    console.log('Test complete');
  } catch (e) {
    console.error('Test failed', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
