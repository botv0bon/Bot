#!/usr/bin/env ts-node
import { startHeliusWebsocketListener } from '../src/heliusWsListener';
import * as tu from '../src/utils/tokenUtils';
import * as ff from '../src/fastTokenFetcher';
import fs from 'fs';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: any = null;
  return Promise.race([p, new Promise<T | null>((res) => { t = setTimeout(() => res(null), ms); })]).then((r) => { if (t) clearTimeout(t); return r as T | null; });
}

async function classifyMint(mint: string) {
  const out: any = { mint, snapshot: null, enrich: null, classifiedAs: 'unknown' };
  try {
    if (ff && typeof (ff as any).getMintSnapshotCached === 'function') {
      const snap = await (ff as any).getMintSnapshotCached(mint).catch(() => null);
      out.snapshot = snap || null;
      if (snap && (snap.liquidity || snap.volume || snap.metadataExists || snap.poolOpenTimeMs || snap._canonicalAgeSeconds)) {
        out.classifiedAs = 'real';
        return out;
      }
    }
  } catch (e) { out.snapshot = { error: (e && (e as Error).message) || String(e) }; }

  // Try cached authoritative enrichment (fast, in-flight-dedupe, concurrency-limited)
  try {
    const timeoutMs = Number(process.env.HELIUS_QUICK_HANDLE_TIMEOUT_MS || 3500);
    const enrichPromise = (ff as any).handleNewMintEventCached ? (ff as any).handleNewMintEventCached(mint) : ((tu as any).officialEnrich ? (async () => { const tokenObj: any = { tokenAddress: mint }; await withTimeout((tu as any).officialEnrich(tokenObj, { timeoutMs }), timeoutMs).catch(() => null); return tokenObj; })() : null);
    const enrichRes = enrichPromise ? await withTimeout(enrichPromise, timeoutMs + 200).catch(() => null) : null;
    out.enrich = enrichRes || null;
    // If authoritative enrichment returned ageSeconds or metadata, use that to classify
    try {
      if (enrichRes && ((enrichRes as any).ageSeconds !== undefined || (enrichRes as any).metadataExists || (enrichRes as any).poolOpenTimeMs || (enrichRes as any).liquidity || (enrichRes as any).volume)) {
          const maxAge = Number(process.env.HELIUS_MAX_MINT_AGE_S || 30);
          const ageOk = (typeof (enrichRes as any).ageSeconds === 'number') ? (Number((enrichRes as any).ageSeconds) <= maxAge) : true;
          if (ageOk && ((enrichRes as any).metadataExists || (enrichRes as any).poolOpenTimeMs || (enrichRes as any).liquidity || (enrichRes as any).volume)) {
            out.classifiedAs = 'real';
          } else {
            out.classifiedAs = 'likely-false';
          }
          return out;
        }
    } catch (e) {}

    // fallback: if enrich did not return decisive info, mark likely-false
    out.classifiedAs = 'likely-false';
  } catch (e) {
    out.enrich = { error: (e && (e as Error).message) || String(e) };
    out.classifiedAs = out.classifiedAs === 'unknown' ? 'unknown' : out.classifiedAs;
  }

  return out;
}

async function main() {
  const MAX = Number(process.env.MEASURE_MAX_EVENTS || 60);
  const TIMEOUT_MS = Number(process.env.MEASURE_TIMEOUT_MS || 90_000);
  console.log(`Measure: collecting up to ${MAX} unique mint events (timeout ${TIMEOUT_MS}ms)...`);

  const collected: any[] = [];

  const api = await startHeliusWebsocketListener({
    onOpen: () => console.log('Listener open'),
    onNewMint: (evt: any) => {
      try {
        if (!evt || !evt.mint) return;
        const key = String(evt.mint).toLowerCase();
        if (collected.find((x) => String(x.mint).toLowerCase() === key)) return;
        collected.push(evt);
        console.log('Collected', collected.length, '->', evt.mint, evt.eventType);
      } catch (e) {}
    }
  } as any);

  // allow writing a partial report if user interrupts (fast, no enrich)
  let interrupted = false;
  function writePartialReport(resultsPartial: any[]) {
    try {
      const summary = { total: resultsPartial.length, real: resultsPartial.filter(r => r.analysis.classifiedAs === 'real').length, likely_false: resultsPartial.filter(r => r.analysis.classifiedAs === 'likely-false').length, unknown: resultsPartial.filter(r => r.analysis.classifiedAs === 'unknown').length };
      const outFile = process.env.MEASURE_OUTFILE || `helius_fp_report_${Date.now()}.json`;
      fs.writeFileSync(outFile, JSON.stringify({ summary, results: resultsPartial }, null, 2));
      console.log('Wrote partial report to', outFile);
    } catch (e) {
      console.error('Failed to write partial report:', e && (e as Error).message);
    }
  }

  process.on('SIGINT', async () => {
    if (interrupted) return;
    interrupted = true;
    console.log('SIGINT received — stopping listener and writing partial report...');
    try { await api.stop(); } catch (e) {}
    const partialResults = collected.map((ev) => ({ event: ev, analysis: { classifiedAs: 'unknown' } }));
    writePartialReport(partialResults);
    process.exit(130);
  });

  // wait until MAX or timeout
  await new Promise<void>((resolve) => {
    const to = setTimeout(() => resolve(), TIMEOUT_MS);
    const iv = setInterval(() => {
      if (collected.length >= MAX) { clearTimeout(to); clearInterval(iv); resolve(); }
    }, 500);
  });

  console.log('Stopping listener, classifying', collected.length, 'events...');
  try { await api.stop(); } catch (e) {}

  // classify in parallel with limited concurrency to avoid long serial runs
  const CONCURRENCY = Number(process.env.MEASURE_CONCURRENCY || 6);
  const results: any[] = new Array(collected.length);
  let idxPtr = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push((async () => {
      while (true) {
        const i = idxPtr++;
        if (i >= collected.length) break;
        try {
          const ev = collected[i];
          const r = await classifyMint(ev.mint);
          results[i] = { event: ev, analysis: r };
        } catch (e) {
          results[i] = { event: collected[i], analysis: { error: (e && (e as Error).message) || String(e), classifiedAs: 'unknown' } };
        }
      }
    })());
  }
  await Promise.all(workers);

  const summary = { total: results.length, real: results.filter(r => r.analysis.classifiedAs === 'real').length, likely_false: results.filter(r => r.analysis.classifiedAs === 'likely-false').length, unknown: results.filter(r => r.analysis.classifiedAs === 'unknown').length };
  console.log('Summary:', summary);
  const outFile = process.env.MEASURE_OUTFILE || `helius_fp_report_${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
  console.log('Wrote report to', outFile);
}

main().catch((e) => { console.error('Measure failed:', e && (e as Error).message); process.exit(1); });
