(async () => {
  // quick smoke test for executeHoneyStrategy logic paths
  const users: any = {
    u1: {
      secret: 'invalid-secret',
      wallet: '11111111111111111111111111111111',
      strategy: { minAge: 0 }
    }
  } as any;
  const { executeHoneyStrategy, getHoneySettings, setHoneySettings } = require('../userStrategy');
  // set a token with mismatched arrays to trigger error path
  setHoneySettings('u1', { repeatOnEntry: false, tokens: [{ address: 'So11111111111111111111111111111111111111112', buyAmount: 0.01, profitPercents: [10], soldPercents: [50,50] }] }, users);

  const getPrice = async (addr: string) => 1;
  const autoBuy = async (addr: string, amount: number, secret: string) => 'tx-buy-mock';
  const autoSell = async (addr: string, amount: number, secret: string) => 'tx-sell-mock';

  try {
    await executeHoneyStrategy('u1', users, getPrice, autoBuy, autoSell);
    console.log('executeHoneyStrategy finished');
  } catch (e) {
    console.error('executeHoneyStrategy threw', e);
  }
})();
