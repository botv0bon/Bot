import 'dotenv/config';

// Simulate signature arrays and parsed tx responses to verify earliest blockTime selection
import { strict as assert } from 'assert';

function normalizeBt(v: any) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (n > 1e12) return Math.floor(n / 1000);
  return n;
}

function pickEarliestFromSigs(arr: any[]) {
  let min: number | null = null;
  let sig: string | null = null;
  for (const s of arr) {
    const bt = normalizeBt(s.blockTime ?? s.block_time ?? s.timestamp ?? null);
    if (bt && (!min || bt < min)) { min = bt; sig = s.signature || s.txHash || null; }
  }
  return { min, sig };
}

async function testCase1() {
  // mix of ms and sec timestamps
  const sigs = [
    { signature: 's1', blockTime: 1755832000000 }, // ms
    { signature: 's2', blockTime: 1755831400 }, // sec
    { signature: 's3' }, // no bt
  ];
  const parsed = { blockTime: 1755831200 };
  const a = pickEarliestFromSigs(sigs);
  // earliest from signatures should be 1755831200 after normalization? Actually s2=1755831400, s1->1755832000, so parsed is earliest
  assert.equal(a.min, 1755831400);
  // now we prefer parsed if earlier
  const parsedNum = normalizeBt(parsed.blockTime);
  const earliest = (!a.min || parsedNum < a.min) ? parsedNum : a.min;
  assert.equal(earliest, 1755831200);
}

async function testCase2() {
  // no blockTime in signatures, rely on parsed tx
  const sigs = [{ signature: 's1' }, { signature: 's2' }];
  const a = pickEarliestFromSigs(sigs);
  assert.equal(a.min, null);
  const parsed = { blockTime: 1755682990000 };
  const p = normalizeBt(parsed.blockTime);
  assert.equal(p, 1755682990);
}

async function run() {
  await testCase1();
  await testCase2();
  console.log('All tests passed');
}

run().catch(e=>{ console.error(e); process.exit(1); });
