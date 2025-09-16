import './silenceLogs';
// Enrichment manager with optional Redis-backed dedupe and in-memory fallback
// - If `REDIS_URL` is set, the manager will attempt to use Redis SET NX + EX
//   to dedupe mint attempts across processes.
// - Otherwise it keeps an in-memory Map for dedupe (non-persistent, single-process).
// - Queue execution (concurrency limiting) remains in-process.

type EnqueueItem = { evt: any; hf: (e: any) => Promise<any> };

export function createEnrichmentManager(opts?: { ttlSeconds?: number; maxConcurrent?: number }) {
  const ttlSeconds = (opts && opts.ttlSeconds) || 300; // default 5 minutes
  const maxConcurrent = (opts && opts.maxConcurrent) || 3;

  // in-memory dedupe map (fallback)
  const lastAttempt: Map<string, number> = new Map();
  const queue: EnqueueItem[] = [];
  let running = 0;

  // Redis client (optional)
  let redisClient: any = null;
  let useRedis = false;
  let redisReady = false;
  const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI || '';

  // init redis but ensure the manager waits a short bounded time for readiness to avoid races
  async function tryInitRedis() {
    if (!REDIS_URL) return;
    if (redisClient) return;
    try {
      const { createClient } = await import('redis');
      redisClient = createClient({ url: REDIS_URL });
      redisClient.on && redisClient.on('error', (e: any) => { try { console.warn('[heliusEnrichmentQueue] redis error', e && e.message ? e.message : e); } catch {} });
      // connect with a bounded timeout
      const p = redisClient.connect();
      const t = new Promise((res) => setTimeout(res, 3000));
      await Promise.race([p, t]);
      // If client did not throw, mark as ready only if connected
      if (redisClient && typeof redisClient.isOpen !== 'undefined' ? redisClient.isOpen : true) {
        useRedis = true;
        redisReady = true;
        try { console.log('[heliusEnrichmentQueue] connected to redis'); } catch {}
      } else {
        // fallback silently
        redisClient = null; useRedis = false; redisReady = false;
      }
    } catch (e) {
      try { console.warn('[heliusEnrichmentQueue] failed to init redis, falling back to in-memory dedupe', e && e.message ? e.message : e); } catch {}
      redisClient = null; useRedis = false; redisReady = false;
    }
  }

  // start init but export promise so callers can await if they need deterministic dedupe
  const _redisInitPromise = tryInitRedis();

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function tryRunNext() {
    if (running >= maxConcurrent) return;
    const item = queue.shift();
    if (!item) return;
    running++;
    (async () => {
      try {
        await item.hf(item.evt);
      } catch (e) {
        try { console.warn('enrichment error', e && e.message ? e.message : e); } catch {}
      } finally {
        running--;
        // schedule next immediately
        setImmediate(tryRunNext);
      }
    })();
  }

  async function redisTrySetDedup(key: string, ttlSecondsLocal: number) {
    // Wait a short time for redis readiness if initialization in progress
    try { await Promise.race([_redisInitPromise, new Promise(res => setTimeout(res, 800))]); } catch {}
    if (!redisClient || !useRedis || !redisReady) return false;
    try {
      // Use SET NX EX (redis v4 client supports options)
      const res = await redisClient.set(key, '1', { NX: true, EX: ttlSecondsLocal });
      return !!res;
    } catch (e) {
      try { console.warn('[heliusEnrichmentQueue] redis set failed, disabling redis dedupe', e && e.message ? e.message : e); } catch {}
      try { redisClient.disconnect && redisClient.disconnect().catch(() => {}); } catch {}
      redisClient = null;
      useRedis = false;
      redisReady = false;
      return false;
    }
  }

  return {
    async enqueue(evt: any, hf: (e: any) => Promise<any>) {
      // Return a Promise that resolves when the handler `hf` actually runs and completes,
      // or resolves immediately with { skipped: true } if dedup prevents execution.
      try {
        const mint = evt && (evt.mint || evt.token || evt.address);
        // create a promise that will be resolved when work completes
        return new Promise<any>(async (resolve) => {
          try {
            if (!mint || typeof mint !== 'string') {
              // nothing to dedupe on; directly queue
              queue.push({ evt, hf: async (e:any) => { const r = await hf(e); resolve(r); return r; } });
              tryRunNext();
              return;
            }

            const key = `helius:enrich:${mint}`;
            const now = nowSec();

            // Prefer Redis dedupe when available (but avoid races: await init briefly)
            if (useRedis || REDIS_URL) {
              try {
                const ok = await redisTrySetDedup(key, ttlSeconds);
                if (!ok) {
                  try { console.log('Enrichment skipped (redis dedupe) for', mint); } catch {}
                  resolve({ skipped: true, reason: 'redis-dedupe' });
                  return;
                }
                // enqueue job and resolve when handler finishes
                queue.push({ evt, hf: async (e:any) => { const r = await hf(e); resolve(r); return r; } });
                tryRunNext();
                return;
              } catch (e) {
                // fallback to in-memory dedupe on redis errors
              }
            }

            // In-memory fallback
            const last = lastAttempt.get(mint) || 0;
            if (now - last < ttlSeconds) {
              try { console.log('Enrichment skipped (in-memory dedupe) for', mint); } catch {}
              resolve({ skipped: true, reason: 'memory-dedupe' });
              return;
            }
            // record attempt time immediately to avoid races
            lastAttempt.set(mint, now);
            queue.push({ evt, hf: async (e:any) => { const r = await hf(e); resolve(r); return r; } });
            tryRunNext();
          } catch (ee) {
            try { console.warn('enrichment manager error', ee && ee.message ? ee.message : ee); } catch {}
            resolve({ skipped: true, reason: 'manager-exception' });
          }
        });
      } catch (e) {
        // don't allow manager errors to escape
        try { console.warn('enrichment manager error', e && e.message ? e.message : e); } catch {}
        return Promise.resolve({ skipped: true, reason: 'enqueue-exception' });
      }
    },
    // Useful for tests/metrics
    stats() {
      return {
        queueLen: queue.length,
        running,
        ttlSeconds,
        maxConcurrent,
        dedupeSize: lastAttempt.size,
        redis: { enabled: !!REDIS_URL, connected: !!redisClient }
      };
    },
    // Expose raw redis client for advanced ops (optional)
    _redisClient: () => redisClient,
  };
}
