import { filterTokensByStrategy } from '../src/bot/strategy';

describe('filterTokensByStrategy preserveSources behavior', () => {
  test('does not merge realtime sources when tokens have sourceProgram', async () => {
    const tokens = [
      { address: 'MintA', tokenAddress: 'MintA', mint: 'MintA', sourceProgram: 'Prog1', sourceSignature: 'S1' },
      { address: 'MintB', tokenAddress: 'MintB', mint: 'MintB', sourceProgram: 'Prog2', sourceSignature: 'S2' }
    ];
    const strategy = { enabled: true } as any;
    const res = await filterTokensByStrategy(tokens, strategy, { fastOnly: false });
    // Expect that the returned tokens contain at least the original addresses
    const addrs = (res || []).map((t:any) => (t.address || t.tokenAddress || t.mint));
    expect(addrs).toEqual(expect.arrayContaining(['MintA','MintB']));
  });
});
