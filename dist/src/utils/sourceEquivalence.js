"use strict";
// Minimal, clean implementation for source equivalence utilities.
// This file is intentionally small so the repo compiles; expand later.
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareSourcesForCache = compareSourcesForCache;
exports.printEquivalenceReport = printEquivalenceReport;
function compareSourcesForCache(cache) {
    if (!Array.isArray(cache))
        return [];
    const out = [];
    for (const item of cache) {
        try {
            const addr = item && (item.tokenAddress || item.address || item.mint || item.pairAddress);
            if (!addr)
                continue;
            const srcs = Array.isArray(item.__sources) ? item.__sources : (item.__sources ? [item.__sources] : []);
            if (!srcs || srcs.length < 2)
                continue;
            const per = {};
            for (const s of srcs) {
                try {
                    const name = s && (s.source || s.name) ? String(s.source || s.name) : 'unknown';
                    const raw = s && s.raw ? s.raw : s;
                    const liquidity = raw ? (raw.liquidity ?? raw.liquidityUsd ?? (raw.liquidity && raw.liquidity.usd) ?? null) : null;
                    const volume = raw ? (raw.volume ?? raw.h24 ?? raw.volumeUsd ?? raw.volume_h24 ?? null) : null;
                    const pairCreated = raw ? (raw.pairCreatedAt ?? raw.poolOpenTimeMs ?? raw.createdAt ?? raw.pairCreatedAtISO ?? null) : null;
                    per[name] = { liquidity: liquidity === null || liquidity === undefined ? null : Number(liquidity), volume: volume === null || volume === undefined ? null : Number(volume), pairCreated: pairCreated === null || pairCreated === undefined ? null : Number(pairCreated) };
                }
                catch (e) {
                    continue;
                }
            }
            // compare numeric fields
            const fields = ['liquidity', 'volume', 'pairCreated'];
            for (const f of fields) {
                const vals = [];
                for (const k of Object.keys(per)) {
                    const v = per[k][f];
                    if (v !== null && v !== undefined && !Number.isNaN(Number(v)))
                        vals.push(Number(v));
                }
                if (vals.length >= 2) {
                    const max = Math.max(...vals);
                    const min = Math.min(...vals);
                    const pct = (min === 0) ? (max === 0 ? 0 : Infinity) : ((max - min) / Math.abs(min)) * 100;
                    if (isFinite(pct) && Math.abs(pct) > 10) {
                        out.push({ address: addr, field: f, mergedValue: item[f] ?? null, sources: per, maxPctDiff: Math.round(pct) });
                    }
                }
            }
        }
        catch (e) {
            continue;
        }
    }
    return out;
}
function printEquivalenceReport(eq) {
    if (!Array.isArray(eq) || eq.length === 0) {
        console.log('[equivalence] no significant discrepancies found');
        return;
    }
    console.log(`[equivalence] found ${eq.length} discrepancy items (showing up to 20):`);
    for (const e of eq.slice(0, 20)) {
        console.log(`- ${e.address} field=${e.field} maxPctDiff=${e.maxPctDiff}% merged=${String(e.mergedValue)}`);
    }
}
