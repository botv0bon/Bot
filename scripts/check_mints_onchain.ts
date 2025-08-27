const fs = require('fs');
const path = require('path');
const { getFirstOnchainTimestamp } = require('../src/utils/tokenUtils');

async function main() {
  const reportFile = process.env.REPORT_FILE || 'helius_fp_report_1756253876338.json';
  const outFile = process.env.OUT_FILE || 'onchain_check_output.json';
  const timeoutPer = Number(process.env.PER_CALL_TIMEOUT_MS || 10000);
  const delayMs = Number(process.env.DELAY_MS || 200);
  const rptPath = path.join(process.cwd(), reportFile);
  if (!fs.existsSync(rptPath)) {
    console.error('Report file not found:', rptPath);
    process.exit(2);
  }
  const raw = fs.readFileSync(rptPath, { encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  const results = [];
  const mints = Array.from(new Set((parsed.results || []).map((r) => r.analysis?.mint || r.event?.mint).filter(Boolean)));
  console.log('Found mints:', mints.length);

  for (let i = 0; i < mints.length; i++) {
    const mint = mints[i];
    console.log(`Checking ${i+1}/${mints.length}: ${mint}`);
    try {
      // ensure each call has an outer timeout to avoid hangs
      const res = await Promise.race([
        getFirstOnchainTimestamp(mint, { timeoutMs: timeoutPer }),
        new Promise(resolve => setTimeout(() => resolve({ ts: null, source: 'timeout' }), timeoutPer + 10))
      ]);
      results.push({ mint, ts: res?.ts ?? null, source: res?.source ?? null, cached: !!res?.cached });
    } catch (e) {
      results.push({ mint, ts: null, source: 'error', error: String(e?.message || e) });
    }
    // small delay
    await new Promise(r => setTimeout(r, delayMs));
  }
  fs.writeFileSync(path.join(process.cwd(), outFile), JSON.stringify({ checkedAt: Date.now(), results }, null, 2), { encoding: 'utf8' });
  console.log('Wrote', outFile);
}

main().catch(e => { console.error(e); process.exit(1); });
