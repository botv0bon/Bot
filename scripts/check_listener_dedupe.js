// Simulate two consecutive show_token calls and apply the same dedupe logic used in telegramBot.ts
(async function(){
  try{
    const ff = require('../dist/src/fastTokenFetcher');
    if(!ff || typeof ff.fetchLatest5FromAllSources !== 'function'){ console.error('fetchLatest5FromAllSources not found'); process.exit(2); }
    const userId = '7948630771';
    const shown = new Set();
    console.log('Fetching first time...');
    const latest1 = await ff.fetchLatest5FromAllSources(5).catch(e=>{ console.error('err1',e); process.exit(3); });
    const tokens1 = (latest1 && latest1.heliusEvents && Array.isArray(latest1.heliusEvents)) ? latest1.heliusEvents.map(m=>String(m).toLowerCase()) : [];
    console.log('Tokens1:', tokens1);
    tokens1.forEach(t=> shown.add(t));
    console.log('\nFetching second time...');
    const latest2 = await ff.fetchLatest5FromAllSources(5).catch(e=>{ console.error('err2',e); process.exit(4); });
    const tokens2 = (latest2 && latest2.heliusEvents && Array.isArray(latest2.heliusEvents)) ? latest2.heliusEvents.map(m=>String(m).toLowerCase()) : [];
    console.log('Tokens2 (raw):', tokens2);
    const new2 = tokens2.filter(t=> !shown.has(t));
    console.log('Tokens2 (new after dedupe):', new2);
    process.exit(0);
  }catch(e){ console.error('Test error', e); process.exit(5); }
})();
