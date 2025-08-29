const fs = require('fs');
const path = require('path');
let filterTokensByStrategy = null;
const distModulePath = path.resolve(__dirname, '..', 'dist', 'src', 'bot', 'strategy.js');
if (fs.existsSync(distModulePath)) {
  const m = require(distModulePath);
  filterTokensByStrategy = m.filterTokensByStrategy || (m.default && m.default.filterTokensByStrategy);
} else {
  // Skip test when compiled dist is not present to avoid requiring TypeScript source files.
  console.warn('\n[SKIP] compiled dist not found at', distModulePath, '\n');
}

describe('filterTokensByStrategy preserveSources behavior', () => {
  test('does not merge realtime sources when tokens have sourceProgram', async () => {
    if (!filterTokensByStrategy) return console.warn('[SKIP TEST] filterTokensByStrategy not available from dist');
    const tokens = [
      { address: 'MintA', tokenAddress: 'MintA', mint: 'MintA', sourceProgram: 'Prog1', sourceSignature: 'S1' },
      { address: 'MintB', tokenAddress: 'MintB', mint: 'MintB', sourceProgram: 'Prog2', sourceSignature: 'S2' }
    ];
    const strategy = { enabled: true };
    const res = await filterTokensByStrategy(tokens, strategy, { fastOnly: false });
    const addrs = (res || []).map((t) => (t.address || t.tokenAddress || t.mint));
    expect(addrs).toEqual(expect.arrayContaining(['MintA','MintB']));
  });
});
