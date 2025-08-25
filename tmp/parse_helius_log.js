const fs = require('fs');
// usage: node tmp/parse_helius_log.js [path] [--min-liquidity N] [--min-volume N] [--max-age-seconds N]
const argPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'helius_run.log';
const argv = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = argv.findIndex(a => a === name);
  if (idx === -1) return defaultVal;
  const v = argv[idx+1];
  if (v === undefined) return defaultVal;
  const n = Number(v);
  return Number.isNaN(n) ? defaultVal : n;
}
const MIN_LIQ = getArg('--min-liquidity', 1);
const MIN_VOL = getArg('--min-volume', 1);
const MAX_AGE = getArg('--max-age-seconds', 60);

const path = argPath;
const raw = fs.readFileSync(path, 'utf8').split('\n');
const objs = [];
for (const line of raw) {
  const jstart = line.indexOf('{');
  if (jstart === -1) continue;
  try {
    const j = JSON.parse(line.slice(jstart));
    if (j.helius_quick_enrich) {
      const e = j.helius_quick_enrich;
      e._rawLine = line;
      objs.push(e);
    }
    if (j.helius_quick_enrich_followup) {
      const e = j.helius_quick_enrich_followup;
      e._rawLine = line;
      objs.push(e);
    }
  } catch (e) {
    continue;
  }
}
// filter for events that have mintSnapshot and pass numeric thresholds
const recent = objs.filter(e => {
  const s = e.mintSnapshot;
  if (!s) return false;
  const age = typeof s.ageSeconds === 'number' ? s.ageSeconds : (s.lastSeenTs ? Math.max(0, Math.floor(Date.now()/1000 - s.lastSeenTs)) : Infinity);
  if (age > MAX_AGE) return false;
  const approxLiquidity = typeof s.approxLiquidity === 'number' ? s.approxLiquidity : (s.approxLiquidity_usd || 0);
  const vol60 = typeof s.volume_60s === 'number' ? s.volume_60s : 0;
  const vol3600 = typeof s.volume_3600s === 'number' ? s.volume_3600s : 0;
  // pass if liquidity >= MIN_LIQ or recent volume >= MIN_VOL
  if (approxLiquidity >= MIN_LIQ) return true;
  if (vol60 >= MIN_VOL) return true;
  if (vol3600 >= MIN_VOL) return true;
  return false;
});
if (recent.length === 0) {
  console.log('No recent mintSnapshot events matching thresholds found in', path);
  process.exit(0);
}
// sort by detectedAt if present
recent.sort((a,b) => new Date(a.detectedAt || 0) - new Date(b.detectedAt || 0));
const first5 = recent.slice(0,5);
const last5 = recent.slice(-5);
console.log('---- FIRST 5 recent mint events (ageSeconds <= 60) ----');
first5.forEach((e,i)=>{
  console.log(i+1, JSON.stringify({mint: e.mint, detectedAt: e.detectedAt, slot: e.slot, signature: e.signature, score: e.score, mintSnapshot: e.mintSnapshot, _diag: e._diag}, null, 0));
});
console.log('\n---- LAST 5 recent mint events (ageSeconds <= 60) ----');
last5.forEach((e,i)=>{
  console.log(i+1, JSON.stringify({mint: e.mint, detectedAt: e.detectedAt, slot: e.slot, signature: e.signature, score: e.score, mintSnapshot: e.mintSnapshot, _diag: e._diag}, null, 0));
});
