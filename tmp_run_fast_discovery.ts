(async ()=>{
  try{
    const ff = require('./src/fastTokenFetcher');
    if (!ff || typeof ff.runFastDiscoveryCli !== 'function') {
      console.error('runFastDiscoveryCli not available on module');
      process.exit(2);
    }
    console.log('Starting runFastDiscoveryCli topN=10 timeoutMs=3000 concurrency=3');
    await ff.runFastDiscoveryCli({ topN: 10, timeoutMs: 3000, concurrency: 3 });
    console.log('runFastDiscoveryCli finished');
  }catch(e){
    console.error('error', e && e.stack ? e.stack : e);
    process.exit(3);
  }
  process.exit(0);
})();
