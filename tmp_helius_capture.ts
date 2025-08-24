(async ()=>{
  try{
    const wsMod = require('./src/heliusWsListener');
    const ff = require('./src/fastTokenFetcher');
    console.log('Starting Helius WS listener for 60s...');
    const inst = await (wsMod.startHeliusWebsocketListener ? wsMod.startHeliusWebsocketListener({
      onOpen: ()=>console.log('WS open'),
      onMessage: (m:any)=>{/* keep quiet to avoid huge logs */},
      onClose: ()=>console.log('WS closed'),
      onError: (e:any)=>console.warn('WS error', e && e.message)
    }) : null);

    await new Promise(r=>setTimeout(r, 60000));

    try{
      const ev = wsMod.getRecentHeliusEvents ? wsMod.getRecentHeliusEvents() : [];
      console.log('captured events count:', Array.isArray(ev)?ev.length:0);
      if (Array.isArray(ev) && ev.length) console.log(JSON.stringify(ev.slice(0,20), null, 2));

      // For each event, run getAccountInfo and helius signature lookup (limited concurrency)
      const limit = Math.min(20, ev.length);
      for (let i=0;i<limit;i++){
        const e = ev[i];
        const mint = e && (e.mint || e.address || e.parsed?.info?.mint);
        if (!mint) continue;
        console.log('\n---\nEvent', i, 'mint=', mint, 'eventType=', e.eventType || 'unknown');
        try{
          const acct = await (ff.getAccountInfo ? ff.getAccountInfo(mint) : Promise.resolve(null));
          console.log('getAccountInfo.ok=', !!(acct && acct.value));
        }catch(err){ console.log('getAccountInfo.err', String(err)); }
        try{
          const sigs = await (ff.heliusGetSignaturesFast ? ff.heliusGetSignaturesFast(mint, process.env.HELIUS_FAST_RPC_URL || process.env.HELIUS_RPC_URL || '', 4000, Number(process.env.HELIUS_RETRIES || 1)) : null);
          if (!sigs) console.log('signatures: null');
          else if (Array.isArray(sigs)) console.log('signatures count:', sigs.length, 'sample0:', JSON.stringify(sigs[0]).slice(0,200));
          else if (sigs.result && Array.isArray(sigs.result)) console.log('signatures count:', sigs.result.length, 'sample0:', JSON.stringify(sigs.result[0]).slice(0,200));
          else console.log('signatures:', JSON.stringify(sigs).slice(0,200));
        }catch(err){ console.log('sigs.err', String(err)); }
      }
    }catch(e){ console.warn('processing err', e && e.message); }

    try{ if (inst && inst.stop) await inst.stop(); }catch(e){}
    console.log('WS capture script done');
  }catch(e){ console.error('script error', e && e.stack ? e.stack : e); process.exit(2); }
  process.exit(0);
})();
