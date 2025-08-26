// One-off script to run live, no-cache filtering for a single user
(async function(){
  try {
    const path = require('path');
    const ff = require(path.join(__dirname, '..', 'src', 'fastTokenFetcher'));
    // Clear in-memory caches used by the app
    try { global.__inMemoryMintStats = new Map(); } catch (e) {}
    try { global.__heliusSigCache = null; } catch (e) {}
    try { global.__heliusAccountCache = null; } catch (e) {}

    const users = require(path.join(__dirname, '..', 'users.json'));
    const uid = '7948630771';
    console.log('USER_STRATEGY:', JSON.stringify(users[uid].strategy || users[uid] || {}, null, 2));

    const opts = { limit: 200, force: true, detail: true, warmupHeliusMs: 0 };
    console.log('Running fetchAndFilterTokensForUsers with opts:', opts);
    const res = await ff.fetchAndFilterTokensForUsers(users, opts);
    const tokens = res && res[uid] ? res[uid] : [];
    console.log('RESULT_COUNT:', tokens.length);
    if (tokens.length > 0) console.log('RESULTS:', JSON.stringify(tokens, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
