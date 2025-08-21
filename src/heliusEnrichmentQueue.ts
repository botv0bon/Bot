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

  const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI || '';
  async function tryInitRedis() {
    if (!REDIS_URL || redisClient) return;
    try {
      const { createClient } = await import('redis');
      redisClient = createClient({ url: REDIS_URL });
      redisClient.on && redisClient.on('error', (e: any) => { try { console.warn('[heliusEnrichmentQueue] redis error', e && e.message ? e.message : e); } catch {} });
      await redisClient.connect();
      useRedis = true;
      try { console.log('[heliusEnrichmentQueue] connected to redis'); } catch {}
    } catch (e) {
      try { console.warn('[heliusEnrichmentQueue] failed to init redis, falling back to in-memory dedupe', e && e.message ? e.message : e); } catch {}
      redisClient = null; useRedis = false;
    }
  }

  // initialize Redis asynchronously but don't block creation
  void tryInitRedis();

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
    if (!redisClient) return false;
    try {
      // SET key value NX EX ttl
      const res = await redisClient.set(key, '1', { NX: true, EX: ttlSecondsLocal });
      // On success returns 'OK', on failure null
      return !!res;
    } catch (e) {
      try { console.warn('[heliusEnrichmentQueue] redis set failed, disabling redis dedupe', e && e.message ? e.message : e); } catch {}
      try { redisClient.disconnect && redisClient.disconnect().catch(() => {}); } catch {}
      redisClient = null;
      useRedis = false;
      return false;
    }
  }

  return {
    async enqueue(evt: any, hf: (e: any) => Promise<any>) {
      try {
        const mint = evt && (evt.mint || evt.token || evt.address);
        if (!mint || typeof mint !== 'string') {
          // nothing to dedupe on; directly queue
          queue.push({ evt, hf });
          tryRunNext();
          return;
        }

        const key = `helius:enrich:${mint}`;
        const now = nowSec();

        // Prefer Redis dedupe when available
        if (useRedis) {
          const ok = await redisTrySetDedup(key, ttlSeconds);
          if (!ok) {
            try { console.log('Enrichment skipped (redis dedupe) for', mint); } catch {}
            return;
          }
          // enqueue job
          queue.push({ evt, hf });
          tryRunNext();
          return;
        }

        // In-memory fallback
        const last = lastAttempt.get(mint) || 0;
        if (now - last < ttlSeconds) {
          try { console.log('Enrichment skipped (in-memory dedupe) for', mint); } catch {}
          return;
        }
        // record attempt time immediately to avoid races
        lastAttempt.set(mint, now);
        queue.push({ evt, hf });
        tryRunNext();
      } catch (e) {
        // don't allow manager errors to escape
        try { console.warn('enrichment manager error', e && e.message ? e.message : e); } catch {}
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
