import fs from 'fs';
import path from 'path';

async function loadTokens() {
  try {
    const tokenUtils = await import('../src/utils/tokenUtils');
    const fetchDex = tokenUtils.fetchDexScreenerTokens;
    const tokens = await fetchDex('solana');
    if (tokens && tokens.length) return tokens;
  } catch (e) {
    // fallthrough to sample
  }
  const samplePath = path.join(process.cwd(), 'sent_tokens', 'test_io_user.json');
  if (fs.existsSync(samplePath)) {
    return JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  }
  console.error('No tokens available (network failed and no sample).');
  return [];
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

function computeAgeSeconds(token: any): number | null {
  let ageVal = getField(token,
    'ageSeconds','ageSeconds', 'ageMinutes', 'age', 'createdAt', 'created_at', 'creation_date', 'created',
    'poolOpenTime', 'listed_at', 'listedAt', 'genesis_date', 'published_at',
    'time', 'timestamp', 'first_trade_time', 'baseToken.createdAt'
  );

  if (typeof ageVal === 'string') {
    const s = ageVal.trim();
    if (/^\d+$/.test(s)) ageVal = Number(s);
    else if (/^(\d+)\.?\d*\s*(s|sec|second)s?$/i.test(s)) {
      ageVal = Number(s.match(/\d+\.?\d*/)?.[0] || 0);
    } else if (/^(\d+)\.?\d*\s*(m|min|minute)s?$/i.test(s)) {
      ageVal = Number(s.match(/\d+\.?\d*/)?.[0] || 0) * 60;
    } else if (/^(\d+)\.?\d*\s*(h|hr|hour)s?$/i.test(s)) {
      ageVal = Number(s.match(/\d+\.?\d*/)?.[0] || 0) * 3600;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(s) || /T/.test(s)) {
      const parsed = Date.parse(s);
      if (!isNaN(parsed)) ageVal = parsed;
    } else if (!isNaN(Number(s))) {
      ageVal = Number(s);
    }
  }

  if (typeof ageVal === 'number' && !isNaN(ageVal)) {
    // heuristics: ms epoch (>1e12), s epoch (>1e9), minutes small (<1e7 treat as minutes)
    if (ageVal > 1e12) { // ms timestamp
      return Math.floor((Date.now() - ageVal) / 1000);
    } else if (ageVal > 1e9) { // s timestamp
      return Math.floor(Date.now() / 1000 - ageVal);
    } else if (ageVal > 0 && ageVal < 1e7) { // likely minutes
      return Math.floor(ageVal * 60);
    }
  }
  return null;
}

(async function main(){
  const tokens = await loadTokens();
  if (!tokens || !tokens.length) { process.exit(1); }
  const matches = [] as any[];
  for (const t of tokens) {
    const ageSec = computeAgeSeconds(t);
    if (ageSec !== null && ageSec >= 1 && ageSec <= 60) {
      matches.push({ token: t, ageSec });
    }
  }
  console.log('Total tokens loaded:', tokens.length);
  console.log('Tokens with age between 1s and 60s:', matches.length);
  for (const m of matches.slice(0, 50)) {
    const addr = m.token.tokenAddress || m.token.address || m.token.mint || m.token.pairAddress || m.token.symbol || m.token.name || 'unknown';
    const price = getField(m.token, 'priceUsd', 'price') || '-';
    console.log(`- ${addr} | ageSec:${m.ageSec} | price:${price}`);
  }
})();
