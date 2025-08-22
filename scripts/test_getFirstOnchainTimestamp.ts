import { getFirstOnchainTimestamp } from '../src/utils/tokenUtils';

async function main() {
  const addrs = [
    // common Solana mints for quick checks (wrapped SOL, token examples)
    'So11111111111111111111111111111111111111112',
    // try a sample mint from sent_tokens if present
    '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E'
  ];
  for (const a of addrs) {
    try {
      const res = await getFirstOnchainTimestamp(a, { timeoutMs: 4000 });
      console.log(`addr=${a} -> ts=${res.ts} source=${res.source} cached=${res.cached}`);
    } catch (e) {
      console.error(`failed ${a}:`, e?.message || e);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
