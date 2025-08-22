import 'dotenv/config';
const ff = require('./src/fastTokenFetcher');
const utils = require('./src/utils/tokenUtils');

console.log('Monitor script started. Polling every 5s. Stop with Ctrl+C.');
const intervalMs = Number(process.env.MONITOR_INTERVAL_MS || 5000);
let running = true;

process.on('SIGINT', () => {
  console.log('\nMonitor stopping (SIGINT)');
  running = false;
  process.exit(0);
});

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
      const latest = await ff.fetchLatest5FromAllSources(200);
      const candidates = Array.from(new Set([...(latest.heliusEvents || []), ...(latest.dexTop || []), ...(latest.heliusHistory || [])]));
      const allTokens = await utils.fetchDexScreenerTokens('solana', { limit: '500' }).catch(() => []);
      const now = Date.now();
      const found: any[] = [];
      for (const mint of candidates.slice(0, 200)) {
        const t = (allTokens || []).find((x: any) => String(x.tokenAddress || x.address || x.mint || '') === String(mint));
        if (!t) continue;
        let ageMin: number | undefined = undefined;
        if (typeof t.ageMinutes === 'number') ageMin = Math.floor(t.ageMinutes);
        if (typeof ageMin === 'undefined') {
          const cs = ['createdAt','created_at','listedAt','published_at','time','timestamp','first_trade_time','poolOpenTimeMs','poolOpenTime'];
          for (const k of cs) {
            const v = t[k] || (t.freshnessDetails && t.freshnessDetails[k]);
            const ts = await toTsFromValue(v);
            if (ts) { ageMin = Math.floor((now - ts) / 60000); t._ageSource = k; t._ageTs = ts; break; }
          }
        }
        if (typeof ageMin === 'undefined' && t.freshnessDetails) {
          const ts = t.freshnessDetails.firstTxMs || t.freshnessDetails.onChainTs || t.freshnessDetails.first_tx_time;
          const ts2 = await toTsFromValue(ts);
          if (ts2) { ageMin = Math.floor((now - ts2) / 60000); t._ageSource = 'freshnessDetails'; t._ageTs = ts2; }
        }
        if (typeof ageMin === 'undefined' && typeof t.ageSeconds === 'number') {
          ageMin = Math.floor(t.ageSeconds / 60);
          t._ageSource = 'ageSeconds';
        }
        t._computedAgeMinutes = typeof ageMin === 'number' ? ageMin : undefined;
        if (typeof t._computedAgeMinutes === 'number' && t._computedAgeMinutes >= 0 && t._computedAgeMinutes <= 5) {
          found.push({ address: t.tokenAddress || t.address || t.mint, name: t.name || t.symbol || '', computedAgeMinutes: t._computedAgeMinutes, ageSource: t._ageSource, liquidity: t.liquidity || t.liquidityUsd || t.marketCap, volume: t.volume || t.volumeUsd });
        }
      }
      if (found.length) console.log(new Date().toISOString(), 'matches:', found.length, JSON.stringify(found.slice(0,10)));
    } catch (e: any) {
      console.error('monitor error:', e && (e.message || e));
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
})();
