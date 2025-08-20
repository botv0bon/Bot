import fs from 'fs';
import path from 'path';

function getArg(idx: number, fallback?: string) {
  return process.argv[idx] || fallback;
}

async function loadTokens() {
  const tokenUtils = await import('../src/utils/tokenUtils');
  const fetchDex = tokenUtils.fetchDexScreenerTokens;
  let tokens: any[] = [];
  try {
    tokens = await fetchDex('solana');
  } catch (e) {
    // fallback to local sample
    const sample = path.join(process.cwd(), 'sent_tokens', 'test_io_user.json');
    if (fs.existsSync(sample)) {
      tokens = JSON.parse(fs.readFileSync(sample, 'utf8'));
    }
  }
  return tokens || [];
}

function getField(token: any, ...fields: string[]) {
  for (const f of fields) {
    const parts = f.split('.');
    let v = token;
    let ok = true;
    for (const p of parts) {
      if (v == null) { ok = false; break; }
      v = v[p];
    }
    if (ok && v !== undefined) return v;
  }
  return undefined;
}

function computeAgeMinutes(token: any): number | null {
  let ageVal = getField(token,
    'ageMinutes', 'age', 'createdAt', 'created_at', 'creation_date', 'created',
    'poolOpenTime', 'listed_at', 'listedAt', 'genesis_date', 'published_at',
    'time', 'timestamp', 'first_trade_time', 'baseToken.createdAt'
  );
  if (typeof ageVal === 'string') {
    const s = ageVal.trim();
    if (/^\d+$/.test(s)) ageVal = Number(s);
    else if (/^\d+\.?\d*\s*(m|min|minute)s?$/i.test(s)) ageVal = Number(s.match(/\d+\.?\d*/)?.[0] || 0);
    else if (/^\d+\.?\d*\s*(h|hr|hour)s?$/i.test(s)) ageVal = (Number(s.match(/\d+\.?\d*/)?.[0] || 0) * 60);
    else if (/^\d{4}-\d{2}-\d{2}/.test(s) || /T/.test(s)) {
      const p = Date.parse(s);
      if (!isNaN(p)) ageVal = p;
    } else if (!isNaN(Number(s))) ageVal = Number(s);
  }
  if (typeof ageVal === 'number' && !isNaN(ageVal)) {
    if (ageVal > 1e12) return Math.floor((Date.now() - ageVal) / 60000);
    if (ageVal > 1e9) return Math.floor((Date.now() - ageVal * 1000) / 60000);
    if (ageVal > 0 && ageVal < 1e7) return Math.floor(ageVal);
  }
  return null;
}

function explainToken(token: any, strategy: any) {
  const reasons: string[] = [];
  const name = token.address || token.tokenAddress || token.mint || token.pairAddress || token.symbol || token.name || 'unknown';
  let price = Number(getField(token, 'priceUsd', 'price', 'priceNative', 'baseToken.priceUsd', 'baseToken.price'));
  if (isNaN(price)) price = 0;
  if (strategy.minPrice !== undefined && price < strategy.minPrice) reasons.push(`price ${price} < minPrice ${strategy.minPrice}`);
  if (strategy.maxPrice !== undefined && price > strategy.maxPrice) reasons.push(`price ${price} > maxPrice ${strategy.maxPrice}`);

  const marketCap = Number(getField(token, 'marketCap', 'fdv', 'baseToken.marketCap', 'baseToken.fdv')) || 0;
  if (strategy.minMarketCap !== undefined && marketCap < strategy.minMarketCap) reasons.push(`marketCap ${marketCap} < minMarketCap ${strategy.minMarketCap}`);

  const liquidity = Number(getField(token, 'liquidity', 'liquidityUsd', 'baseToken.liquidity', 'baseToken.liquidityUsd')) || 0;
  if (strategy.minLiquidity !== undefined && liquidity < strategy.minLiquidity) reasons.push(`liquidity ${liquidity} < minLiquidity ${strategy.minLiquidity}`);

  let volume = Number(getField(token, 'volume', 'volume24h', 'amount', 'totalAmount', 'baseToken.volume', 'baseToken.amount')) || 0;
  if (strategy.minVolume !== undefined && volume < strategy.minVolume) reasons.push(`volume ${volume} < minVolume ${strategy.minVolume}`);

  const holders = Number(getField(token, 'holders', 'totalAmount', 'baseToken.holders', 'baseToken.totalAmount')) || 0;
  if (strategy.minHolders !== undefined && holders < strategy.minHolders) reasons.push(`holders ${holders} < minHolders ${strategy.minHolders}`);

  const ageMinutes = computeAgeMinutes(token);
  if (ageMinutes === null) {
    if (typeof strategy.minAge === 'number' && strategy.minAge > 1) reasons.push(`unknown age (needs >=${strategy.minAge} min)`);
  } else {
    if (strategy.minAge !== undefined && ageMinutes < strategy.minAge) reasons.push(`age ${ageMinutes}min < minAge ${strategy.minAge}min`);
  }

  const verified = getField(token, 'verified', 'baseToken.verified') === true || getField(token, 'verified', 'baseToken.verified') === 'true';
  if (strategy.onlyVerified === true && !verified) reasons.push('not verified');

  if (strategy.enabled === false) reasons.push('strategy disabled');

  return { name, reasons, price, marketCap, liquidity, volume, holders, ageMinutes, verified };
}

async function main() {
  const userIdArg = getArg(2);
  const usersPath = path.join(process.cwd(), 'users.json');
  if (!fs.existsSync(usersPath)) { console.error('users.json not found'); process.exit(1); }
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  const userId = userIdArg || Object.keys(users)[0];
  if (!userId || !users[userId]) { console.error('user not found:', userId); process.exit(1); }
  const user = users[userId];
  const strategy = user.strategy || {};
  console.log('User:', userId);
  console.log('Strategy:', JSON.stringify(strategy));

  const tokens = await loadTokens();
  if (!tokens || !tokens.length) { console.error('No tokens available'); process.exit(1); }
  console.log('Loaded tokens:', tokens.length);

  // Get authoritative accepted set from the main strategy filter
  let acceptedSet = new Set<string>();
  try {
    const strategyModule = await import('../src/bot/strategy');
    const accepted = await strategyModule.filterTokensByStrategy(tokens, strategy);
    for (const t of accepted) {
      const addr = t.address || t.tokenAddress || t.mint || t.pairAddress || t.symbol || t.name;
      if (addr) acceptedSet.add(String(addr));
    }
  } catch (e) {
    console.warn('Failed to run canonical filterTokensByStrategy, falling back to local logic:', e?.message || e);
  }

  let accepted = 0;
  const DEFAULT_MAX_AGE_MINUTES = Number(process.env.DEFAULT_MAX_AGE_MINUTES || 10000);
  const maxAge = typeof (strategy as any).maxAge === 'number' ? (strategy as any).maxAge : DEFAULT_MAX_AGE_MINUTES;

  for (const t of tokens) {
    const out = explainToken(t, strategy);
    const addr = t.address || t.tokenAddress || t.mint || t.pairAddress || t.symbol || t.name || 'unknown';
    const isAccepted = acceptedSet.size ? acceptedSet.has(String(addr)) : out.reasons.length === 0;
    // Augment reasons with maxAge info for clarity
    if (out.ageMinutes !== null && out.ageMinutes > maxAge) {
      out.reasons.push(`age ${out.ageMinutes}min > maxAge ${maxAge}min`);
    }
    // Compute and print freshness score/details (best-effort, short timeout)
    try {
      const utils = await import('../src/utils/tokenUtils');
      const res = await utils.withTimeout(utils.computeFreshnessScore(t), 2000, 'dbg-freshness');
      // attach if present
      if (res && typeof res.score === 'number') {
        t.freshnessScore = res.score;
        t.freshnessDetails = res.details;
      }
    } catch (e) {
      // ignore
    }

    if (isAccepted) {
      accepted++;
      console.log(`ACCEPT: ${out.name} | price:${out.price} | age:${out.ageMinutes}min | mcap:${out.marketCap} | liq:${out.liquidity} | vol:${out.volume} | freshness:${t.freshnessScore || '-'} | details:${JSON.stringify(t.freshnessDetails || {})}`);
    } else {
      console.log(`REJECT: ${out.name} | reasons: ${out.reasons.join('; ')} | freshness:${t.freshnessScore || '-'} | details:${JSON.stringify(t.freshnessDetails || {})}`);
    }
  }
  console.log(`\nResult: ${accepted} accepted / ${tokens.length} total`);
}

main().catch(e => { console.error(e); process.exit(1); });
