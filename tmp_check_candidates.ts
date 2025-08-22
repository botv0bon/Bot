(async ()=>{
  const ff = require('./src/fastTokenFetcher');
  const tu = require('./src/utils/tokenUtils');
  const limit = Number(process.env.CAND_LIMIT || 200);
  console.log(`Fetching candidates with sources (limit=${limit})`);
  const rawList = await ff.fetchLatestWithSources(limit);
  console.log(`Candidates fetched: ${rawList.length}`);

  // Clean and normalize candidate strings to valid Solana mints where possible
  function cleanRawCandidate(s: string) {
    if (!s || typeof s !== 'string') return s;
    // remove obvious labels/suffixes (pump, bonk, moon, 777, etc.) at end
    s = s.replace(/(?:[-_]?\b(pump|bonk|moon|777|moon|pm|am)\b)$/i, '');
    // trim trailing non-alphanum
    s = s.replace(/[^A-Za-z0-9]+$/i, '');
    return s.trim();
  }

  const normalizedSet = new Set<string>();
  for (const it of rawList) {
    const raw = it && it.mint ? String(it.mint) : null;
    if (!raw) continue;
    const cleaned = cleanRawCandidate(raw);
    const norm = tu.normalizeMintCandidate ? tu.normalizeMintCandidate(cleaned) : cleaned;
    if (norm) normalizedSet.add(norm);
  }
  const normalizedList = Array.from(normalizedSet).slice(0, limit);
  console.log(`Normalized valid mints: ${normalizedList.length}`);
  const concurrency = Number(process.env.HELIUS_VALIDATE_CONCURRENCY || 6);
  const firstTimeout = Number(process.env.FIND_FRESH_TIMEOUT_MS || 8000);
  let idx = 0;
  const out: any[] = [];

  async function enrichOne(mint: string, source?: string) {
    const sourceTag = source || 'normalized';
    // account info via helius (may return __error)
    let acct: any = null;
  try { acct = ff.getAccountInfo ? await ff.getAccountInfo(mint) : null; } catch (e: any) { acct = { __error: String(e) }; }

    // first onchain timestamp (unified helper). Respect timeout env.
    let first: any = { ts: null, source: 'none', cached: false };
    try {
      if (tu.getFirstOnchainTimestamp) {
        const res = await tu.getFirstOnchainTimestamp(mint, { timeoutMs: firstTimeout });
        if (res) {
          first = res;
          if (first && first.ts) first.iso = new Date(Number(first.ts)).toISOString();
        }
      }
    } catch (e: any) { first = { __error: String(e) }; }

    // DexScreener enrichment (profile + pairs) if available
    let dexProfile: any = null;
    let dexPairs: any[] = [];
    try {
      if (typeof tu.fetchDexScreenerProfiles === 'function') {
          const profiles = await tu.fetchDexScreenerProfiles('solana', { tokenAddress: mint });
          dexProfile = Array.isArray(profiles) && profiles.length ? profiles[0] : null;
        }
    } catch (e: any) { dexProfile = { __error: String(e) }; }
    try {
      if (typeof tu.fetchDexScreenerPairsForSolanaTokens === 'function') {
        dexPairs = await tu.fetchDexScreenerPairsForSolanaTokens([mint]);
      }
    } catch (e: any) { dexPairs = [{ __error: String(e) }]; }

    // derive liquidity/volume and pairCreatedAt from pairs if available
    let liquidity = null, volume = null, pairCreatedAtISO = null;
  if (Array.isArray(dexPairs) && dexPairs.length) {
      const p = dexPairs[0];
      liquidity = p?.liquidity?.usd ?? p?.liquidity ?? null;
      volume = p?.volume ?? p?.volumeUsd ?? null;
      let pc = p?.pairCreatedAt || p?.createdAt || p?.baseToken?.createdAt || null;
      if (typeof pc === 'number' && pc < 1e12 && pc > 1e9) pc = pc * 1000;
      if (typeof pc === 'string' && !isNaN(Date.parse(pc))) pc = Date.parse(pc);
      if (typeof pc === 'number' && pc > 0) pairCreatedAtISO = new Date(pc).toISOString();
    }

    return {
      mint,
      source,
      acctExists: !!(acct && acct.value),
      acct: acct && (acct.value ? acct.value : acct),
      firstOnchain: first,
      firstOnchainISO: first && first.ts ? new Date(Number(first.ts)).toISOString() : null,
      dexProfile: dexProfile ? { name: dexProfile.name, symbol: dexProfile.symbol, tokenAddress: dexProfile.tokenAddress } : null,
      dexPairsSample: Array.isArray(dexPairs) ? (dexPairs.slice(0,2)) : dexPairs,
      liquidity,
      volume,
      pairCreatedAtISO
    };
  }

  // Enrich normalized list sequentially (or with limited concurrency)
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= normalizedList.length) break;
      const m = normalizedList[i];
      try {
        const rec = await enrichOne(m, 'normalized');
        out.push(rec);
      } catch (e) {
        out.push({ mint: String(m), error: String(e) });
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, normalizedList.length)) }, () => worker());
  await Promise.all(workers);

  // Pretty print: JSON array + table summary
  console.log(JSON.stringify(out, null, 2));
  console.log('\nSummary table:');
  for (const r of out) {
    const name = r.dexProfile?.name || '';
    const sym = r.dexProfile?.symbol || '';
    const acct = r.acctExists ? 'YES' : (r.acct && r.acct.__error ? `ERR:${r.acct.__error}` : 'NO');
    const first = r.firstOnchainISO || 'N/A';
    const liq = r.liquidity !== null ? String(r.liquidity) : 'N/A';
    const vol = r.volume !== null ? String(r.volume) : 'N/A';
    console.log(`- ${r.mint} | src=${r.source} | acct=${acct} | created=${first} | liq=${liq} | vol=${vol} | name=${name} ${sym}`);
  }
})();
