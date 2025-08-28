"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTLCache = void 0;
exports.withTimeout = withTimeout;
exports.createLimiter = createLimiter;
exports.makeSourceMeta = makeSourceMeta;
exports.getHostLimiter = getHostLimiter;
exports.retryWithBackoff = retryWithBackoff;
exports.enrichMetricInc = enrichMetricInc;
exports.enrichMetricsSnapshot = enrichMetricsSnapshot;
/**
 * Wrap a promise with a soft timeout. Returns an object with ok/result or ok=false/error.
 */
async function withTimeout(p, ms) {
    let timer = null;
    try {
        const wrapped = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), ms);
            p.then((r) => { if (timer)
                clearTimeout(timer); resolve({ ok: true, result: r }); }).catch((e) => { if (timer)
                clearTimeout(timer); resolve({ ok: false, error: String(e && e.message ? e.message : e) }); });
        });
        return await wrapped;
    }
    catch (e) {
        if (timer)
            clearTimeout(timer);
        return { ok: false, error: String(e && e.message ? e.message : e) };
    }
}
/**
 * Simple concurrency limiter factory. Returns a function that wraps an async function.
 */
function createLimiter(concurrency) {
    const queue = [];
    let active = 0;
    async function run(fn) {
        if (active >= concurrency) {
            await new Promise((res) => queue.push(res));
        }
        active++;
        try {
            const r = await fn();
            return r;
        }
        finally {
            active--;
            const next = queue.shift();
            if (next)
                next();
        }
    }
    return run;
}
/** helper to build a SourceMeta object quickly */
function makeSourceMeta(name, ok, opts) {
    return { source: name, ok, error: opts?.error ?? null, latencyMs: opts?.latencyMs ?? null, raw: opts?.raw };
}
// Simple per-host limiter map. Call getHostLimiter(host, concurrency) to get a run(fn) wrapper.
const __hostLimiters = {};
function getHostLimiter(host, concurrency = 2) {
    try {
        if (!host)
            return createLimiter(concurrency);
        if (!__hostLimiters[host])
            __hostLimiters[host] = createLimiter(concurrency);
        return __hostLimiters[host];
    }
    catch (e) {
        return createLimiter(concurrency);
    }
}
/**
 * Retry helper with exponential backoff for HTTP calls. Expects fn to return a Promise (usually axios request).
 * Retries on network errors, timeouts, and HTTP 429/5xx responses.
 */
async function retryWithBackoff(fn, opts) {
    const retries = Number(opts?.retries ?? 2);
    const baseMs = Number(opts?.baseMs ?? 200);
    const maxMs = Number(opts?.maxMs ?? 60000);
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            attempt++;
            const status = err && err.response && err.response.status ? Number(err.response.status) : null;
            const isRetryable = status === 429 || (status && status >= 500 && status < 600) || err.code === 'ECONNABORTED' || err.code === 'ENOTFOUND' || !status;
            if (!isRetryable || attempt > retries)
                throw err;
            try {
                if (opts?.onRetry)
                    opts.onRetry(err, attempt);
            }
            catch (e) { }
            // Honor Retry-After header when available (seconds or HTTP-date). Fall back to exponential backoff + jitter.
            try {
                const headers = err && err.response && err.response.headers ? err.response.headers : null;
                const ra = headers && (headers['retry-after'] || headers['Retry-After']);
                if (ra) {
                    let waitMs = 0;
                    const raStr = String(ra);
                    // numeric seconds
                    if (/^\s*\d+\s*$/.test(raStr)) {
                        waitMs = Number(raStr) * 1000;
                    }
                    else {
                        // try HTTP date
                        const dt = Date.parse(raStr);
                        if (!isNaN(dt)) {
                            waitMs = Math.max(0, dt - Date.now());
                        }
                    }
                    // add small jitter and cap
                    const jitter = Math.floor(Math.random() * Math.min(1000, baseMs));
                    waitMs = Math.min(maxMs, waitMs + jitter);
                    if (waitMs > 0)
                        await new Promise((r) => setTimeout(r, waitMs));
                    else
                        await new Promise((r) => setTimeout(r, Math.min(maxMs, baseMs)));
                    continue;
                }
            }
            catch (e) {
                // ignore parse errors and fall back to exponential backoff
            }
            const backoff = Math.min(maxMs, baseMs * Math.pow(2, Math.min(10, attempt - 1)) + Math.floor(Math.random() * baseMs));
            await new Promise((r) => setTimeout(r, backoff));
            continue;
        }
    }
}
// Simple TTL cache (in-memory). Not persistent. Values expire after ttlMs.
class TTLCache {
    constructor(ttlMs = 1000 * 60) {
        this.map = new Map();
        this.ttlMs = ttlMs;
    }
    get(key) {
        const it = this.map.get(key);
        if (!it)
            return undefined;
        if (Date.now() > it.exp) {
            this.map.delete(key);
            return undefined;
        }
        return it.v;
    }
    set(key, value, ttlMs) {
        const exp = Date.now() + (typeof ttlMs === 'number' ? ttlMs : this.ttlMs);
        this.map.set(key, { v: value, exp });
    }
    has(key) { return this.get(key) !== undefined; }
    del(key) { this.map.delete(key); }
    clear() { this.map.clear(); }
}
exports.TTLCache = TTLCache;
// Simple in-memory metrics for quick diagnostics (non-persistent)
const __enrichMetrics = { enrichment_queue_len: 0, enrichment_dedupe_skips: 0 };
function enrichMetricInc(key, by = 1) {
    try {
        __enrichMetrics[key] = (Number(__enrichMetrics[key] || 0) + Number(by));
    }
    catch (e) { }
}
function enrichMetricsSnapshot() { return { ...__enrichMetrics }; }
