import fs from 'fs';
import path from 'path';
const fsp = fs.promises;
import { HELIUS_ENRICH_LIMIT } from '../config';

// Lightweight background queue for expensive token enrichment requested by users.
// Jobs are appended to an NDJSON file for audit and processed with a single-worker
// loop to avoid flooding external providers.

export type EnrichJob = { userId: string; strategy: any; requestTs: number; chatId?: number };

const QUEUE_DIR = path.join(process.cwd(), 'queue');
const QUEUE_FILE = path.join(QUEUE_DIR, 'jobs.ndjson');
const PROCESSED_FILE = path.join(QUEUE_DIR, 'processed.ndjson');

let running = false;
let telegramRef: any | null = null;
let usersRef: Record<string, any> | null = null;
let workerOpts = { concurrency: 1, intervalMs: 2000 };

async function ensureQueueDir() {
  try { await fsp.mkdir(QUEUE_DIR, { recursive: true }); } catch {}
}

async function appendNdjson(file: string, obj: any) {
  await ensureQueueDir();
  const line = JSON.stringify(obj) + '\n';
  await fsp.appendFile(file, line, 'utf8');
}

export async function enqueueEnrichJob(job: EnrichJob) {
  try {
    await appendNdjson(QUEUE_FILE, job);
  } catch (e) {
    console.error('[enrichQueue] Failed to persist job:', e);
  }
  // in-memory quick push handled by worker loop which re-reads file; for now just persistence
  return true;
}

async function loadJobsFromFile(): Promise<EnrichJob[]> {
  try {
    const stat = await fsp.stat(QUEUE_FILE).catch(() => false);
    if (!stat) return [];
    const data = await fsp.readFile(QUEUE_FILE, 'utf8');
    return data.split('\n').filter(Boolean).map(l => JSON.parse(l) as EnrichJob);
  } catch (e) {
    return [];
  }
}

export async function startEnrichQueue(telegram: any, users: Record<string, any>, opts?: Partial<typeof workerOpts>) {
  telegramRef = telegram;
  usersRef = users;
  workerOpts = { ...workerOpts, ...(opts || {}) };
  if (running) return;
  running = true;
  console.log('[enrichQueue] started with opts', workerOpts);

  (async () => {
    while (running) {
  try {
  const jobs = await loadJobsFromFile();
  if (jobs.length) console.log('[enrichQueue] found jobs:', jobs.length);
        if (!jobs.length) {
          await new Promise(r => setTimeout(r, workerOpts.intervalMs));
          continue;
        }

        // process jobs one by one to be conservatively gentle with providers
        const job = jobs.shift();
        if (!job) { await new Promise(r => setTimeout(r, workerOpts.intervalMs)); continue; }

  // mark as processed (append to processed file)
  const processedRecord: any = { job, startedAt: Date.now() };
  try { await appendNdjson(PROCESSED_FILE, processedRecord); } catch {}

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

          // write processed record with results length
          processedRecord.finishedAt = Date.now();
          processedRecord.resultCount = filtered ? filtered.length : 0;
          try { await appendNdjson(PROCESSED_FILE, processedRecord); } catch {}
         } catch (e) {
           console.error('[enrichQueue] Job processing error:', e);
         }
 
         // truncate the queue file by removing the first processed line(s)
         try {
           const raw = await fsp.readFile(QUEUE_FILE, 'utf8');
           const lines = raw.split('\n').filter(Boolean);
           lines.shift();
           await fsp.writeFile(QUEUE_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
         } catch (e) {}
 
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
