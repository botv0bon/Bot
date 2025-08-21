Redis-backed dedupe for Helius enrichment

This project supports optional Redis-backed dedupe for the Helius enrichment manager.

How it works:
- If you set the environment variable REDIS_URL (eg: redis://:password@host:6379), the enrichment manager will attempt to connect to Redis and use an atomic SET NX EX call to record a mint key when an enrichment job is enqueued. This prevents duplicate enrichment for the same mint across processes and restarts for the configured TTL.
- If REDIS_URL is not set or Redis is unavailable, the manager falls back to an in-memory Map-based dedupe (single-process only).

Configuration:
- REDIS_URL: optional. If present, enables Redis dedupe.
- HELIUS_ENRICH_TTL_SECONDS: optional. If you want to change TTL, set when creating the manager; default is 300 seconds.

Notes:
- Redis is only used for dedupe keys. The job queue and concurrency limiting remain in-process.
- If Redis becomes unreachable, the manager will log a warning and continue using in-memory dedupe to avoid dropping jobs.
