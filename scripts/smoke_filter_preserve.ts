import dotenv from 'dotenv'; dotenv.config();
async function main(){
  try{
    const module = await import('../src/bot/strategy');
    const utils = await import('../src/utils/tokenUtils');
    const filter = module.filterTokensByStrategy;
    if(!filter) { console.error('filterTokensByStrategy not found'); process.exit(1); }
    const tokens = [
      { address: 'MintA', tokenAddress: 'MintA', mint: 'MintA', sourceProgram: 'Prog1', sourceSignature: 'S1' },
      { address: 'MintB', tokenAddress: 'MintB', mint: 'MintB', sourceProgram: 'Prog2', sourceSignature: 'S2' },
      { address: 'So11111111111111111111111111111111111111112', tokenAddress: 'So11111111111111111111111111111111111111112', mint: 'So11111111111111111111111111111111111111112', sourceProgram: 'ProgSys' }
    ];
    console.log('Running filterTokensByStrategy with listener-like tokens (should preserve sources and skip system mint)');
    const userStrategy = { enabled: true, maxTrades: 3 } as any;
    const matched = await filter(tokens, userStrategy, { fastOnly: false });
    console.log('Matched count:', Array.isArray(matched)? matched.length : 0);
    for(const t of (matched||[])){
      const msg = utils.buildPreviewMessage(t);
      console.log('PREVIEW:', msg.shortMsg);
    }
  }catch(e){ console.error('smoke error', e && e.message || e); process.exit(1); }
  process.exit(0);
}
main();
