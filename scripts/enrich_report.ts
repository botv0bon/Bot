import fs from 'fs';
import path from 'path';

async function main() {
  try {
    const axios = require('axios');
    const reportFile = process.env.REPORT_FILE || (() => {
      const files = fs.readdirSync(process.cwd()).filter(f => f.startsWith('helius_fp_report_') && f.endsWith('.json'));
      files.sort();
      return files.length ? files[files.length - 1] : null;
    })();
    if (!reportFile) {
      console.error('No report file found. Set REPORT_FILE env or place helius_fp_report_*.json in cwd');
      process.exit(2);
    }
    const raw = fs.readFileSync(path.join(process.cwd(), reportFile), 'utf8');
  const j = JSON.parse(raw);
  const rows: any[] = j.results || [];

  const tu = require('../src/utils/tokenUtils');
    const ff = require('../src/fastTokenFetcher');
    const DEX_TPL = process.env.DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS || 'https://api.dexscreener.com/token-pairs/v1/solana/So11111111111111111111111111111111111111112';

  function humanDuration(ms: number) {
      if (!ms || ms <= 0) return '0s';
      const s = Math.floor(ms/1000);
      const w = Math.floor(s / (7*24*3600));
      const d = Math.floor((s % (7*24*3600)) / (24*3600));
      const h = Math.floor((s % (24*3600)) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      const parts = [] as string[];
      if (w) parts.push(w + 'w');
      if (d) parts.push(d + 'd');
      if (h) parts.push(h + 'h');
      if (m) parts.push(m + 'm');
      if (!parts.length) parts.push(sec + 's');
      return parts.join(' ');
    }

    // Safe wrapper to call a promise with a soft timeout and clear logging for diagnostics.
    async function callWithTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<{ timedOut?: boolean; error?: any; result?: T }> {
      try {
        const res = await Promise.race([
          p.then((r: any) => ({ __ok: true, r })).catch((e: any) => ({ __err: e })),
          new Promise(resolve => setTimeout(() => resolve({ __timedOut: true }), ms))
        ] as any);
        if (res && res.__timedOut) return { timedOut: true };
        if (res && res.__err) return { error: res.__err };
        return { result: res.r };
      } catch (e) {
        return { error: e };
      }
    }

  const out: any[] = [];
  const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
  const SKIP_ONCHAIN = String(process.env.SKIP_ONCHAIN || 'false').toLowerCase() === 'true';
  console.log('Enrich report start:', reportFile, 'rows=', (j && j.results ? j.results.length : 0), 'DRY_RUN=', DRY_RUN);
    // Prefer the project's normalizer which validates via PublicKey
    function extractFromRaw(rawObj: any) {
      try {
        // Try direct normalization first
        const asStr = (rawObj && typeof rawObj === 'string') ? rawObj : JSON.stringify(rawObj || '');
        const norm = tu.normalizeMintCandidate(asStr);
        if (norm) return norm;
        // fallback: try stringify and normalize
        const txt = JSON.stringify(rawObj || '');
        return tu.normalizeMintCandidate(txt);
      } catch (e) {}
      return null;
    }

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      console.log(`processing ${idx+1}/${rows.length} mint candidate...`);
      try {
        // Obtain a normalized mint candidate using tokenUtils (validates via PublicKey)
        let mint: string | null = null;
  try {
          const rawCandidate = r.event && r.event.mint ? String(r.event.mint) : null;
          mint = tu.normalizeMintCandidate(rawCandidate) || extractFromRaw(r.event && r.event.raw ? r.event.raw : r) || null;
        } catch (e) { mint = null; }
        if (!mint) {
          const item: any = { mint: r.event && r.event.mint ? String(r.event.mint) : null, eventType: r.event.eventType || null, note: 'invalid-mint' };
          out.push(item);
          continue;
        }
        const item: any = { mint, eventType: r.event.eventType || null };
        // first onchain timestamp (fast). When DRY_RUN is set we skip network calls.
        let firstMs: number | null = null;
  if (!DRY_RUN && !SKIP_ONCHAIN) {
          try {
      console.log('  -> fetch first-onchain (short) for', mint);
        const shortWrap = await callWithTimeout(tu.getFirstOnchainTimestamp(mint, { timeoutMs: 5000 }), 6000, 'first-short');
        if (shortWrap.timedOut) {
          console.log('    -> first-onchain (short) timed out');
        } else if (shortWrap.error) {
          console.log('    -> first-onchain (short) error:', String(shortWrap.error).slice(0,200));
        } else if (shortWrap.result && shortWrap.result.ts) {
          firstMs = shortWrap.result.ts;
          console.log('    -> first-onchain (short) ok source=', shortWrap.result.source || 'unknown');
        }
            if (res && res.ts) firstMs = res.ts;
          } catch (e) {}
          // If not found quickly, try a longer attempt preferring RPC then Helius
          if (!firstMs) {
            try {
              const res2 = await tu.getFirstOnchainTimestamp(mint, { timeoutMs: 15000, prefer: ['rpc','hel'] }).catch(() => ({ ts: null }));
              const longWrap = await callWithTimeout(tu.getFirstOnchainTimestamp(mint, { timeoutMs: 15000, prefer: ['rpc','hel'] }), 16000, 'first-long');
              if (longWrap.timedOut) {
                console.log('    -> first-onchain (long) timed out');
              } else if (longWrap.error) {
                console.log('    -> first-onchain (long) error:', String(longWrap.error).slice(0,200));
              } else if (longWrap.result && longWrap.result.ts) {
                firstMs = longWrap.result.ts; item._firstResolved = 'fallback_long';
                console.log('    -> first-onchain (long) ok source=', longWrap.result.source || 'unknown');
              }
            } catch (e) {}
          }
          // Final fallback: direct RPC helper (may be slower)
      if (!firstMs) {
            try {
        const rpcDirect = await tu.getFirstTxTimestampFromRpc(mint).catch(() => null);
              if (rpcDirect) { firstMs = rpcDirect; item._firstResolved = 'rpc_direct'; }
            } catch (e) {}
          }
          // fallback: try fastTokenFetcher ensure or cached snapshot
          try {
            console.log('  -> try getMintSnapshotCached for', mint);
            const snapWrap = await callWithTimeout(ff.getMintSnapshotCached(mint), 5000, 'snapshot-cached');
            if (snapWrap.timedOut) console.log('    -> getMintSnapshotCached timed out');
            else if (snapWrap.error) console.log('    -> getMintSnapshotCached error:', String(snapWrap.error).slice(0,200));
            else if (snapWrap.result) {
              const snap = snapWrap.result;
              item.snapshot = snap;
              if (!firstMs && snap.firstBlockTime) firstMs = snap.firstBlockTime;
            }
          } catch (e) {}
        } else {
          // DRY_RUN: populate snapshot if available synchronously from cached function paths (no network)
          try {
            console.log('  -> DRY_RUN: try getMintSnapshotCached for', mint);
            const snapWrap = await callWithTimeout(ff.getMintSnapshotCached(mint), 2000, 'snapshot-cached-dry');
            if (snapWrap && snapWrap.result) item.snapshot = snapWrap.result;
          } catch (e) {}
        }

        item.firstBlockTimeMs = firstMs;
        item.age = firstMs ? humanDuration(Date.now() - Number(firstMs)) : 'unknown';

        // try Dexscreener lookup
        try {
          console.log('  -> fetch Dexscreener for', mint);
          const url = DEX_TPL.replace(/So11111111111111111111111111111111111111112/g, encodeURIComponent(mint));
          const resp = await axios.get(url, { timeout: 4000 }).catch(() => null);
          if (resp && resp.data) {
            item.dex = resp.data;
            // extract basic metrics if available
            if (resp.data && Array.isArray(resp.data.pairs) && resp.data.pairs.length) {
              const p = resp.data.pairs[0];
              item.dex_top_pair = {
                pair: p.pairAddress || p.pair || null,
                liquidity: p.liquidity || p.liquidityUsd || null,
                volume_24h: p.volumeUsd || p.volume || null,
                price: p.price || null,
              };
            }
          }
        } catch (e) {}

        // basic normalized outputs
        out.push(item);
      } catch (e) {
        // continue
      }
    }

    // print summarized table
    for (const it of out) {
      console.log('---');
      console.log('mint:', it.mint);
      console.log('eventType:', it.eventType);
      console.log('firstBlockTime (ms):', it.firstBlockTimeMs);
      console.log('age:', it.age);
      if (it.snapshot) {
        console.log('snapshot.ageSeconds:', it.snapshot.ageSeconds);
        if (typeof it.snapshot.approxLiquidity !== 'undefined') console.log('approxLiquidity:', it.snapshot.approxLiquidity);
        if (typeof it.snapshot.volume_60s !== 'undefined') console.log('vol_60s:', it.snapshot.volume_60s, 'vol_3600s:', it.snapshot.volume_3600s);
      }
      if (it.dex_top_pair) {
        console.log('dex.top.pair:', JSON.stringify(it.dex_top_pair));
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('ERR', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
