(async () => {
  try {
    const ws = require('./src/heliusWsListener');
    const ff = require('./src/fastTokenFetcher');
    const evs = ws.getRecentHeliusEvents ? ws.getRecentHeliusEvents() : [];
    console.log('recent events count', evs.length);
    const withSlot = (evs || []).filter(e => e && (e.firstSlot || (e.raw && (e.raw.params && e.raw.params.result && e.raw.params.result.context && e.raw.params.result.context.slot))))
      .slice(0, 10);
    console.log('events with slot:', withSlot.length);
    for (const e of withSlot) {
      try {
        console.log('\nCalling handleNewMintEvent for', e.mint, 'firstSlot=', e.firstSlot || (e.raw && e.raw.params && e.raw.params.result && e.raw.params.result.context && e.raw.params.result.context.slot));
        const res = await ff.handleNewMintEvent(e, {}, null);
        console.log('result:', res);
      } catch (err) { console.error('call err', err && err.message ? err.message : err); }
    }
  } catch (e) { console.error('failed', e && e.message ? e.message : e); process.exit(1); }
})();
