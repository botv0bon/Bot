import './src/disableEverything';
import 'dotenv/config';
const ff = require('./src/fastTokenFetcher');
const utils = require('./src/utils/tokenUtils');
const intervalMs = Number(process.env.MONITOR_INTERVAL_MS || 5000);
const MONITOR_ENABLED = String(process.env.MONITOR_ENABLED || '').toLowerCase() === 'true';
const SEQUENTIAL_COLLECTOR_ONLY = String(process.env.SEQUENTIAL_COLLECTOR_ONLY || 'false').toLowerCase() === 'true';
let running = true;

if (!MONITOR_ENABLED && !SEQUENTIAL_COLLECTOR_ONLY) {
  console.log('[monitor] MONITOR_ENABLED not set and SEQUENTIAL_COLLECTOR_ONLY=false - exiting without starting monitor loop.');
  process.exit(0);
}

process.on('SIGINT', () => { running = false; process.exit(0); });

async function toTsFromValue(v: any) {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    return null;
  }
  if (typeof v === 'string') {
    const p = Date.parse(v);
    return isNaN(p) ? null : p;
  }
  return null;
}

(async function main() {
  while (running) {
    try {
      // Use only the sequential collector to produce canonical fresh-mints output
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const seq = require('./scripts/sequential_10s_per_program.js');
        if (seq && typeof seq.collectFreshMints === 'function') {
          const items = await seq.collectFreshMints({ maxCollect: 10, timeoutMs: 20000 }).catch(() => []);
          const addrs = (Array.isArray(items) ? items.map((it: any) => (typeof it === 'string' ? it : (it && (it.mint || it.tokenAddress || it.address)))).filter(Boolean) : []);
          if (addrs.length) {
            const meta = { time: new Date().toISOString(), program: 'sequential-collector', signature: null, kind: 'initialize', freshMints: addrs, sampleLogs: [] };
            try { if (typeof seq.emitCanonicalStream === 'function') seq.emitCanonicalStream(addrs, meta); else { process.stdout.write(JSON.stringify(addrs)+'\n'); process.stdout.write(JSON.stringify(meta)+'\n'); } } catch (e) {}
          }
        }
      } catch (e) {}
    } catch (e: any) {
      console.error('monitor error:', e && (e.message || e));
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
})();
