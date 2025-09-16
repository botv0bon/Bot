#!/usr/bin/env node
try{ require('../../src/disableEverything'); }catch(e){}
import dotenv from 'dotenv'; dotenv.config();
const LISTENER_ONLY_MODE = String(process.env.LISTENER_ONLY_MODE ?? process.env.LISTENER_ONLY ?? 'false').toLowerCase() === 'true';
const ENRICH_WORKER_ENABLED = String(process.env.ENRICH_WORKER_ENABLED || '').toLowerCase() === 'true';

// Minimal enrichment worker process that starts the existing enrichQueue
// and runs indefinitely. Use this when you want background enrichment to
// run separately from the Telegram bot process.

(async function main(){
  try{
    if (LISTENER_ONLY_MODE) {
      console.log('[enrichWorker] LISTENER_ONLY_MODE=true - exiting without starting enrich worker.');
      process.exit(0);
    }
    if (!ENRICH_WORKER_ENABLED) {
      console.log('[enrichWorker] ENRICH_WORKER_ENABLED not set - not starting background enrich worker.');
      process.exit(0);
    }
    const { startEnrichQueue, stopEnrichQueue } = await import('./enrichQueue');
    // telegramRef may be unavailable in a worker-only process; we still pass a thin shim
    const telegramShim = { sendMessage: async (chatId:number|string, msg:string, opts?:any) => { console.log('[enrichWorker] shim sendMessage', chatId, msg); } };
    const users = (await import('../../users.json')).default || (await import('../../users.json'));
    startEnrichQueue(telegramShim as any, users, { intervalMs: Number(process.env.ENRICH_WORKER_INTERVAL_MS || 2000) });
    console.log('[enrichWorker] started');
    process.on('SIGINT', async () => { console.log('[enrichWorker] SIGINT received - stopping'); stopEnrichQueue(); process.exit(0); });
    process.on('SIGTERM', async () => { console.log('[enrichWorker] SIGTERM received - stopping'); stopEnrichQueue(); process.exit(0); });
  }catch(e){ console.error('[enrichWorker] startup failed', e); process.exit(1); }
})();
