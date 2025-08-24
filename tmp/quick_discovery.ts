require("ts-node/register");
(async () => {
  try {
  const f = require("./src/fastTokenFetcher");
    const tu = require("./utils/tokenUtils");
    console.log("[test] Fetching unified candidates (limit=200)...");
    const candidates = await f.getUnifiedCandidates(200).catch(e=>{ console.error('[test] getUnifiedCandidates err', e && e.message); return []; });
    console.log('[test] candidates count=', (candidates||[]).length);
    const uniq = Array.from(new Set((candidates||[]).map(c=>c.mint))).slice(0,200);
    console.log('[test] unique candidates=', uniq.length);
    const entries = uniq.map(a=>({ tokenAddress: a, address: a, mint: a }));

    console.log('[test] Ensuring canonical on-chain ages (timeoutMs=3000, concurrency=3)...');
    await f.ensureCanonicalOnchainAges(entries, { timeoutMs: 3000, concurrency: 3 }).catch(e=>{ console.error('[test] ensureCanonicalOnchainAges err', e && e.message); });

    console.log('[test] Fetching DexScreener tokens (limit=500) to get volume info...');
    let dexArr = [];
    try { const ds = await tu.fetchDexScreenerTokens('solana', { limit: String(500) }); dexArr = Array.isArray(ds) ? ds : (ds && ds.data) ? ds.data : []; } catch(e) { console.error('[test] dex fetch err', e && e.message); }
    const dexMap: Record<string, any> = {};
    for (const d of (dexArr||[])) {
      try {
        const addr = tu.normalizeMintCandidate(d.address || d.tokenAddress || d.pairAddress || (d.token && d.token.address) || d.mint || null);
        if (addr) dexMap[addr] = d;
      } catch (e) {}
    }

    const matches: any[] = [];
    for (const e of entries) {
      try {
        const addr = e.tokenAddress || e.address || e.mint;
        const meta = dexMap[addr] || {};
        const volume = Number(meta.volumeUsd ?? meta.volume ?? meta.h24 ?? meta.volume24 ?? 0) || 0;
        const ageSec = (typeof e._canonicalAgeSeconds === 'number') ? e._canonicalAgeSeconds : (e.firstBlockTime ? (Math.floor(Date.now()/1000) - Math.floor(Number(e.firstBlockTime))) : null);
        const ageMin = (ageSec === null || ageSec === undefined) ? null : (ageSec/60);
        if (ageMin !== null && ageMin >= 0 && ageMin <= 40 && volume >= 50) {
          matches.push({ address: addr, ageMin: Math.round(ageMin*100)/100, volume, firstBlockTime: e.firstBlockTime || null, sources: e.__sources || null });
        }
      } catch (e) {}
    }

    matches.sort((a,b)=> (a.ageMin || 0) - (b.ageMin || 0));
    console.log('[test] Total matches (0-40min, vol>=50$):', matches.length);
    for (const r of matches.slice(0,5)) console.log(JSON.stringify(r));
  } catch (err) {
    console.error('[test] script error', err && err.stack);
    process.exit(1);
  }
})();
