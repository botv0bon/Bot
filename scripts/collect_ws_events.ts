import 'dotenv/config';
const path = require('path');
const fs = require('fs');

(async function main() {
  const dur = Number(process.argv[2] || 20) * 1000;
  console.log('Starting Helius WS collector for', dur/1000, 'seconds');
  try {
    const mod = await import('../src/heliusWsListener');
    if (!mod || !mod.startHeliusWebsocketListener) {
      console.error('heliusWsListener not available');
      process.exit(1);
    }
    const inst = await mod.startHeliusWebsocketListener({ onOpen: () => console.log('WS open'), onMessage: (m:any)=>{} });
    // wait
    await new Promise((r) => setTimeout(r, dur));
    const events = mod.getRecentHeliusEvents() || [];
    console.log('Collected events:', events.length);
    const outdir = path.join(process.cwd(), 'logs', 'raw_sources');
    try { fs.mkdirSync(outdir, { recursive: true }); } catch (e) {}
    const file = path.join(outdir, `ws_events_${Date.now()}.ndjson`);
    const w = fs.createWriteStream(file, { flags: 'w' });
    for (const e of events) {
      w.write(JSON.stringify(e) + '\n');
    }
    w.end();
    console.log('Wrote', file);
    try { await inst.stop(); } catch (e) {}
    // filter events within last 5 minutes
    const now = Math.floor(Date.now()/1000);
    const recent = events.filter((ev:any)=> (ev.detectedAtSec && Math.abs(now - ev.detectedAtSec) <= 300));
    console.log('Events within last 5 minutes:', recent.length);
    for (const r of recent.slice(0,10)) console.log(JSON.stringify(r).slice(0,300));
  } catch (e:any) {
    console.error('Collector error:', e && e.message);
    process.exit(1);
  }
})();
