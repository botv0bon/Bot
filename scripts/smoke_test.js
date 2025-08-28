(async () => {
  try {
    console.log('Smoke test starting');
    const path = require('path');
    const ff = require(path.join(__dirname, '..', 'dist', 'src', 'fastTokenFetcher.js'));

    // minimal mock telegram
    const telegram = {
      sendMessage: async (uid, msg) => { console.log(`[telegram:${uid}] ${msg}`); }
    };

    // two mock users with simple strategies
    const users = {
      'u1': { strategy: { enabled: true, buyAmount: 0, autoBuy: false } },
      'u2': { strategy: { enabled: true, buyAmount: 0, autoBuy: false } }
    };

    // call mintPreviouslySeen with a fake mint
    try {
      const r = await ff.mintPreviouslySeen('DummyMintAddress111111111111111111111111', null, null);
      console.log('mintPreviouslySeen result:', r);
    } catch (e) { console.log('mintPreviouslySeen error', e && e.message ? e.message : e); }

    // call handleNewMintEventCached on a fake mint (should return null or detection)
    try {
      const det = await ff.handleNewMintEventCached('DummyMintAddress111111111111111111111111', 10);
      console.log('handleNewMintEventCached result:', det);
    } catch (e) { console.log('handleNewMintEventCached error', e && e.message ? e.message : e); }

    // run fetchAndFilterTokensForUsers with mock users (should not crash)
    try {
      const out = await ff.fetchAndFilterTokensForUsers(users, { limit: 5, force: true, detail: true });
      console.log('fetchAndFilterTokensForUsers returned per-user counts:', Object.keys(out).reduce((acc,k)=>{acc[k]= (out[k]||[]).length; return acc;},{}) );
    } catch (e) { console.log('fetchAndFilterTokensForUsers error', e && e.message ? e.message : e); }

    console.log('Smoke test done');
  } catch (e) {
    console.error('Smoke test fatal', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
