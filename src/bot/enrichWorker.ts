#!/usr/bin/env node
import dotenv from 'dotenv'; dotenv.config();

// Minimal enrichment worker process that starts the existing enrichQueue
// and runs indefinitely. Use this when you want background enrichment to
// run separately from the Telegram bot process.

(async function main(){
  try{
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
