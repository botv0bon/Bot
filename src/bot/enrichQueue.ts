import { HELIUS_ENRICH_LIMIT } from '../config';

// Respect global listener-only mode (no background enrichment)
const LISTENER_ONLY_MODE = String(process.env.LISTENER_ONLY_MODE ?? process.env.LISTENER_ONLY ?? 'false').toLowerCase() === 'true';

// Lightweight in-memory background queue for expensive token enrichment requested by users.
// Jobs are stored in-process only to avoid any disk-based central cache files.

export type EnrichJob = { userId: string; strategy: any; requestTs: number; chatId?: number };

const QUEUE_IN_MEMORY: EnrichJob[] = [];
let running = false;
let telegramRef: any | null = null;
let usersRef: Record<string, any> | null = null;
let workerOpts = { concurrency: 1, intervalMs: 2000 };

export async function enqueueEnrichJob(job: EnrichJob) {
  try {
    if (LISTENER_ONLY_MODE) {
      console.warn('[enrichQueue] enqueue requested but LISTENER_ONLY_MODE=true - dropping job', job && job.userId);
      return false;
    }
    QUEUE_IN_MEMORY.push(job);
    return true;
  } catch (e) {
    console.error('[enrichQueue] enqueue failed:', e);
    return false;
  }
}

export async function startEnrichQueue(telegram: any, users: Record<string, any>, opts?: Partial<typeof workerOpts>) {
  if (LISTENER_ONLY_MODE) {
    console.warn('[enrichQueue] start requested but LISTENER_ONLY_MODE=true - not starting background enrichment.');
    return;
  }
  telegramRef = telegram;
  usersRef = users;
  workerOpts = { ...workerOpts, ...(opts || {}) };
  if (running) return;
  running = true;
  console.log('[enrichQueue] started (in-memory) with opts', workerOpts);

  (async () => {
    while (running) {
      try {
        const jobs = QUEUE_IN_MEMORY.splice(0, QUEUE_IN_MEMORY.length);
        if (!jobs.length) {
          await new Promise(r => setTimeout(r, workerOpts.intervalMs));
          continue;
        }

        // process jobs sequentially
        const job = jobs.shift();
        if (!job) { await new Promise(r => setTimeout(r, workerOpts.intervalMs)); continue; }

        // perform enrichment and notify user (best-effort)
        try {
          // dynamic imports to avoid startup cycles
          const tokenUtils = await import('../utils/tokenUtils');
          const strategyModule = await import('./strategy');
          const fetchDex = tokenUtils.fetchDexScreenerTokens;
          const autoFilter = tokenUtils.autoFilterTokens;
          const enrichTokenTimestamps = tokenUtils.enrichTokenTimestamps;
          const filterTokensByStrategy = (strategyModule as any).filterTokensByStrategy;

          const extraParams: Record<string, string> = {};
          for (const f of tokenUtils.STRATEGY_FIELDS) {
            if (!(f.key in job.strategy)) continue;
            const v = job.strategy[f.key];
            if (v === undefined || v === null) continue;
            if (f.type === 'number') {
              const n = Number(v);
              if (!isNaN(n) && n !== 0) extraParams[f.key] = String(n);
            } else if (f.type === 'boolean') {
              extraParams[f.key] = v ? '1' : '0';
            } else {
              extraParams[f.key] = String(v);
            }
          }

          let tokens = [] as any[];
          try { tokens = await fetchDex('solana', extraParams); } catch (e) { tokens = await fetchDex('solana'); }

          // quick prefilter
          let prefiltered = tokens;
          try { prefiltered = autoFilter(tokens, job.strategy); } catch {}

          // enrich only a small slice
          const enrichLimit = Number(HELIUS_ENRICH_LIMIT || 8);
          const toEnrich = prefiltered.slice(0, enrichLimit);
          try { await enrichTokenTimestamps(toEnrich, { batchSize: 3, delayMs: 400 }); } catch (e) {}

          // merge back timestamps
          const enrichedMap = new Map(toEnrich.map((t: any) => [(t.tokenAddress || t.address || t.mint || t.pairAddress), t]));
          for (let i = 0; i < tokens.length; i++) {
            const key = tokens[i].tokenAddress || tokens[i].address || tokens[i].mint || tokens[i].pairAddress;
            if (enrichedMap.has(key)) tokens[i] = enrichedMap.get(key);
          }

          const filtered = await filterTokensByStrategy(tokens, job.strategy, { preserveSources: true });

          // notify user if matches
          const chatId = job.chatId || (usersRef && usersRef[job.userId] && (usersRef[job.userId].id || usersRef[job.userId].userId || usersRef[job.userId].telegramId));
          if (filtered && filtered.length && telegramRef && chatId) {
            const top = filtered.slice(0, Math.max(1, job.strategy?.maxTrades || 5));
            const msg = `🔔 Background: Found ${filtered.length} tokens matching your strategy. Showing up to ${top.length} now.`;
            try { await telegramRef.sendMessage(chatId, msg); } catch (e) {}
            // send a compact summary with links
            for (const t of top) {
              const address = t.tokenAddress || t.address || t.mint || t.pairAddress;
              const name = t.name || t.symbol || address;
              const dexUrl = t.url || (t.pairAddress ? `https://dexscreener.com/solana/${t.pairAddress}` : '');
              const price = t.priceUsd || t.price || '-';
              const body = `• ${name} (<code>${address}</code>)\nPrice: ${price} USD\n<a href='${dexUrl}'>DexScreener</a> | <a href='https://solscan.io/token/${address}'>Solscan</a>`;
              try { await telegramRef.sendMessage(chatId, body, { parse_mode: 'HTML' }); } catch (e) {}
            }
          } else if (telegramRef && chatId) {
            try { await telegramRef.sendMessage(chatId, 'ℹ️ Background: No tokens matched your strategy at this time.'); } catch (e) {}
          }

        } catch (e) {
          console.error('[enrichQueue] Job processing error:', e);
        }

        // small pause before next job
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error('[enrichQueue] Loop error:', e);
        await new Promise(r => setTimeout(r, workerOpts.intervalMs));
      }
    }
  })();
}

export function stopEnrichQueue() { running = false; }
