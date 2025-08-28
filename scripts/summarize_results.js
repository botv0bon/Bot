const fs = require('fs');
const path = require('path');

const inPath = path.resolve(__dirname, 'last_run_results.json');
const outPath = path.resolve(__dirname, 'last_run_summary.json');

if (!fs.existsSync(inPath)) {
  console.error('Input file not found:', inPath);
  process.exit(2);
}

const raw = fs.readFileSync(inPath, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error('Failed to parse JSON:', err.message);
  process.exit(3);
}

const results = [];

const poolKw = ['initializepool','createpool','initialize pool','create pool','initialize_pool','initializePool','create_pool','createPool','initializeLiquidity','Instruction: Create','CreateIdempotent'];
const mintKw = ['mintto','mint_to','mint_to','MintTo','mintTo','Instruction: Mint'];
const swapKw = ['swap','Instruction: Swap','Instruction: Route','Instruction: Swap:','Instruction: SwapIn','Instruction: SwapOut'];

function classify(summaryLog, mints, accounts) {
  const txt = (summaryLog || []).join(' | ').toLowerCase();
  if (poolKw.some(k => txt.includes(k))) return 'pool_creation';
  if (mintKw.some(k => txt.includes(k))) return 'mint';
  if (swapKw.some(k => txt.includes(k))) return 'swap';
  // fallback heuristics: many distinct mints + CreateIdempotent -> pool or mint
  if ((mints || []).length >= 2 && txt.includes('createidempotent')) return 'mint_or_pool';
  // if logs contain 'initialize' or 'initialize mint'
  if (txt.includes('initialize') && (mints||[]).length>0) return 'mint_or_pool';
  return 'other';
}

for (const prog of data.results || []) {
  const program = prog.program;
  for (const it of prog.found || []) {
    const kind = classify(it.summaryLog, it.mints, it.accounts);
    const blockTime = it.blockTime || 0;
    results.push({
      program,
      signature: it.signature,
      blockTime,
      timeISO: blockTime ? new Date(blockTime*1000).toISOString() : null,
      kind,
      mints: (it.mints||[]).slice(0,4),
      summaryLog: (it.summaryLog||[]).slice(0,6),
      accountsCount: (it.accounts||[]).length
    });
  }
}

// keep only likely events
const likely = results.filter(r => ['pool_creation','mint','swap','mint_or_pool'].includes(r.kind));
// sort newest first
likely.sort((a,b) => (b.blockTime||0) - (a.blockTime||0));
// limit to top 50
const top = likely.slice(0, 50);

const out = {
  generatedAt: new Date().toISOString(),
  totalCandidates: results.length,
  likelyCount: likely.length,
  top: top
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

// print a compact human readable list
for (const e of top) {
  console.log(`${e.timeISO || '-'}  ${e.program}  ${e.kind}  ${e.signature}  mints:${(e.mints||[]).join(', ')}  logs:${(e.summaryLog||[]).join(' | ')}`);
}

console.error('\nWrote summary to', outPath);
