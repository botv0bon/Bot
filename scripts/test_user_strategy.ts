import fs from 'fs';
import path from 'path';

async function main() {
  const usersPath = path.join(process.cwd(), 'users.json');
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  const userId = Object.keys(users)[0];
  const user = users[userId];
  console.log('Testing strategy for user:', userId);
  const strategy = user.strategy;

  // attempt to load fetchDexScreenerTokens
  try {
    const tokenUtils = await import('../src/utils/tokenUtils');
    const fetchDex = tokenUtils.fetchDexScreenerTokens;
    console.log('Fetching tokens from DexScreener... (may use network)');
    let tokens = [] as any[];
    try {
      tokens = await fetchDex('solana');
    } catch (e) {
      console.warn('fetchDex failed, falling back to local sample:', e?.message || e);
    }
    if (!tokens || !tokens.length) {
      const samplePath = path.join(process.cwd(), 'sent_tokens', 'test_io_user.json');
      if (fs.existsSync(samplePath)) {
        console.log('Loading local sample tokens from', samplePath);
        tokens = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
      } else {
        console.error('No tokens available to test. Exiting.');
        process.exit(1);
      }
    }

    const strategyModule = await import('../src/bot/strategy');
    const filtered = await strategyModule.filterTokensByStrategy(tokens, strategy);
    console.log('Found', filtered.length, 'matching tokens. Showing top 10:');
    for (const t of filtered.slice(0, 10)) {
      console.log('-', t.address || t.tokenAddress || t.mint || t.pairAddress, t.name || t.symbol || '', 'price:', t.priceUsd || t.price || '-')
    }
  } catch (e) {
    console.error('Error running test script:', e);
    process.exit(1);
  }
}

main();
