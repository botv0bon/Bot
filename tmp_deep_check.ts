(async ()=>{
  try{
    const ff = require('./src/fastTokenFetcher');
    // Ensure the in-process global cache is populated so subsequent checks see the latest data
    try {
      if (ff && typeof ff.fetchAndFilterTokensForUsers === 'function') {
        console.log('Populating in-process global cache via fetchAndFilterTokensForUsers(force=true)...');
        await ff.fetchAndFilterTokensForUsers({}, { limit: 200, force: true }).catch((e: any) => { console.warn('fetchAndFilterTokensForUsers error', e && e.message ? e.message : e); });
        console.log('populate done');
      }
    } catch (e) {}
    const now = Date.now();
    const global = ff.getGlobalFetchCache ? ff.getGlobalFetchCache() : [];
    const mapped = (global||[]).map((g:any)=>({
      addr: g.tokenAddress || g.address || g.mint || g.addr || '(no-addr)',
      poolOpenTimeMs: g.poolOpenTimeMs || g.firstSeenAtMs || null,
      sourceTags: g.sourceTags || g.__sources || null,
    })).filter(x=>x.poolOpenTimeMs).map((x:any)=>({ ...x, ageMin: (now - Number(x.poolOpenTimeMs))/60000 })).sort((a:any,b:any)=>a.poolOpenTimeMs - b.poolOpenTimeMs);

    console.log('global cache size:', (global||[]).length);
    if(!mapped.length){ console.log('no entries with poolOpenTimeMs/firstSeenAtMs found in cache'); process.exit(0); }

    // show newest 40 (most recent last) but print newest first
    const newest = mapped.slice(-40).reverse();
    console.log('Newest entries (up to 40):');
    for(const it of newest.slice(0,40)){
      console.log(`- ${it.addr}  poolOpenTimeMs=${it.poolOpenTimeMs}  ageMin=${it.ageMin.toFixed(2)}`);
    }

    const recent5 = newest.filter(x=>x.ageMin>=0 && x.ageMin<=5).slice(0,5);
    console.log('\nentries with age <= 5 minutes:', recent5.length);
    if(!recent5.length){ console.log('No tokens <=5min found; you can increase window or run live WS listener to capture new mints.'); process.exit(0); }

    for(const it of recent5){
      console.log('\n---\nChecking', it.addr, 'ageMin=', it.ageMin.toFixed(2));
      try{ const acct = await (ff.getAccountInfo ? ff.getAccountInfo(it.addr) : Promise.resolve(null)); console.log('getAccountInfo ok:', !!(acct && acct.value)); }catch(e){ console.log('getAccountInfo err', String(e)); }
      try{ const sigs = await (ff.heliusGetSignaturesFast ? ff.heliusGetSignaturesFast(it.addr, process.env.HELIUS_FAST_RPC_URL || process.env.HELIUS_RPC_URL || '', 2000, 0) : null); console.log('signatures count:', Array.isArray(sigs) ? sigs.length : (sigs ? Object.keys(sigs).length : 0)); }catch(e){ console.log('sigs err', String(e)); }
    }
  }catch(e){ console.error('script error', e && e.stack ? e.stack : e); process.exit(2); }
  process.exit(0);
})();
