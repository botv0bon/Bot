// Minimal safe Helius WebSocket listener.
// Uses centralized config from `src/config.ts` so env parsing is in one place.
import { HELIUS_USE_WEBSOCKET, getHeliusWebsocketUrl, HELIUS_SUBSCRIBE_METADATA, HELIUS_SUBSCRIBE_SPLTOKEN } from './config';
const HELIUS_WS_URL = getHeliusWebsocketUrl();
const USE_WS = HELIUS_USE_WEBSOCKET;
const SUBSCRIBE_METADATA = HELIUS_SUBSCRIBE_METADATA;
const SUBSCRIBE_SPLTOKEN = HELIUS_SUBSCRIBE_SPLTOKEN;

// Confidence threshold for automatic enrichment (0.0 - 1.0). Can be tuned via env.
const HELIUS_ENRICH_SCORE_THRESHOLD = Number(process.env.HELIUS_ENRICH_SCORE_THRESHOLD ?? 0.6);

// Simple in-memory stats for listener (useful for quick diagnostics)
const _heliusListenerStats = { processed: 0, enriched: 0, skippedLowConfidence: 0, parseErrors: 0 };

export function getHeliusListenerStats() { try { return { ..._heliusListenerStats }; } catch { return null; } }
export function resetHeliusListenerStats() { try { _heliusListenerStats.processed = 0; _heliusListenerStats.enriched = 0; _heliusListenerStats.skippedLowConfidence = 0; _heliusListenerStats.parseErrors = 0; } catch {} }

// Lazy import so project can run without ws installed when not used
async function startHeliusWebsocketListener(options?: { onMessage?: (msg: any) => void; onOpen?: () => void; onClose?: () => void; onError?: (err: any) => void; }) {
  if (!USE_WS) {
    console.log('HELIUS WebSocket disabled via HELIUS_USE_WEBSOCKET=false');
    return { stop: () => Promise.resolve() };
  }

  if (!HELIUS_WS_URL) {
    console.warn('HELIUS_WEBSOCKET_URL not set in .env; WebSocket listener will not start.');
    return { stop: () => Promise.resolve() };
  }

  const wsModule = await import('ws');
  const WebSocket = (wsModule as any).default || wsModule;

  const ws = new WebSocket(HELIUS_WS_URL, {
    // no extra options; Helius typically accepts api-key in query string
    handshakeTimeout: 5000,
  } as any);

  let closed = false;
  // recent events buffer (in-memory) to allow polling latest events
  const recentEvents: any[] = [];
  function pushEvent(ev: any) {
    try {
  recentEvents.unshift(ev);
  try { console.log('Helius detected event', ev && ev.mint, ev && ev.eventType); } catch {}
      if (recentEvents.length > 200) recentEvents.length = 200;
    } catch {}
  }

  ws.on('open', () => {
    options?.onOpen && options.onOpen();
    console.log('HELIUS WebSocket connected');
    try {
      // automatic subscriptions for common programs
      const subscriptions: Record<number, string> = {};
      let sid = 1;
      const sendSub = (method: string, params: any, tag: string) => {
        const id = sid++;
        subscriptions[id] = tag;
        try { ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })); } catch (e) {}
        console.log('Sent subscribe', tag, method);
      };
      if (SUBSCRIBE_METADATA) {
        // Metaplex Token Metadata program
        const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
        sendSub('logsSubscribe', [{ mentions: [METADATA_PROGRAM] }, { commitment: 'confirmed' }], 'metadata');
      }
      if (SUBSCRIBE_SPLTOKEN) {
        const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
        sendSub('logsSubscribe', [{ mentions: [SPL_TOKEN_PROGRAM] }, { commitment: 'confirmed' }], 'spl-token');
      }
      // listen for subscription confirmations in messages (they come as normal JSON responses)
      ws.on('message', (m) => {
        try {
          const parsed = typeof m === 'string' ? JSON.parse(m) : JSON.parse(m.toString());
          if (parsed && typeof parsed === 'object' && parsed.id && subscriptions[parsed.id]) {
            console.log('Subscription confirmed:', subscriptions[parsed.id], 'id=', parsed.result ?? parsed.id);
          }
        } catch (e) {}
      });
    } catch (e) {
      // ignore subscription failures
    }
  });

  ws.on('message', (data) => {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
      // Single onMessage callback
      try { options?.onMessage && options.onMessage(parsed); } catch (e) {}
      try {
        const evt = analyzeHeliusMessage(parsed);
        if (!evt) return;
        pushEvent(evt);
        try { if ((options as any)?.onNewMint) (options as any).onNewMint(evt); } catch (e) {}

        _heliusListenerStats.processed = (_heliusListenerStats.processed || 0) + 1;
        const score = computeEventConfidence(evt, parsed);
        if (typeof score !== 'number' || Number.isNaN(score) || score < HELIUS_ENRICH_SCORE_THRESHOLD) {
          _heliusListenerStats.skippedLowConfidence = (_heliusListenerStats.skippedLowConfidence || 0) + 1;
          try { console.log('Skipping enrichment due to low confidence', evt.mint || '(no-mint)', 'score=', typeof score === 'number' && score.toFixed ? score.toFixed(2) : score); } catch {}
          return;
        }

        // proceed with enrichment
        try {
          const ff = require('./fastTokenFetcher');
          const hf = ff && (ff.handleNewMintEvent || ff.default && ff.default.handleNewMintEvent);
          if (typeof hf === 'function') {
            try {
              const mgrMod = require('./heliusEnrichmentQueue');
              const mgr = (mgrMod && mgrMod._manager) || (mgrMod && mgrMod.createEnrichmentManager && (mgrMod._manager = mgrMod.createEnrichmentManager({ ttlSeconds: 300, maxConcurrent: 3 })));
              const p = mgr.enqueue(evt, hf);
              _heliusListenerStats.enriched = (_heliusListenerStats.enriched || 0) + 1;
              if (p && typeof p.then === 'function') {
                const safeString = (v: any, n = 400) => { try { if (!v && v !== 0) return ''; if (typeof v === 'string') return v.slice(0,n); return JSON.stringify(v).slice(0,n); } catch { try { return String(v).slice(0,n); } catch { return ''; } } };
                p.then((res: any) => {
                  try {
                    if (res && res.skipped) console.log('Enrichment result skipped for', evt.mint || '(no-mint)', 'reason=', res.reason);
                    else if (res) console.log('Enrichment completed for', evt.mint || '(no-mint)', safeString(res, 400));
                  } catch (e) {}
                }).catch((err: any) => { try { console.warn('Enrichment promise rejected', err && err.message ? err.message : err); } catch {} });
              }
            } catch (e) {
              try { hf(evt).catch(() => {}); } catch {}
            }
          }
        } catch (e) { /* swallow enrichment path errors */ }
      } catch (e) { _heliusListenerStats.parseErrors = (_heliusListenerStats.parseErrors || 0) + 1; }
    } catch (err) {
      _heliusListenerStats.parseErrors = (_heliusListenerStats.parseErrors || 0) + 1;
      console.warn('Failed to parse Helius WS message', err);
    }
  });

  ws.on('close', (code, reason) => {
    closed = true;
    options?.onClose && options.onClose();
    console.log('HELIUS WebSocket closed', code, reason?.toString());
  });

  ws.on('error', (err) => {
    options?.onError && options.onError(err);
    console.warn('HELIUS WebSocket error', err?.message || err);
  });

  function stop() {
    return new Promise<void>((resolve) => {
      if (closed) return resolve();
      try {
        ws.once('close', () => resolve());
        ws.close();
      } catch (e) {
        resolve();
      }
    });
  }

  // Public API
  const api = {
    ws,
    stop,
    getRecentEvents: () => Array.isArray(recentEvents) ? recentEvents.slice() : [],
  };
  // save instance for global getter
  try { saveLastInstance(api); } catch {}
  return api;
}

export { startHeliusWebsocketListener };

// Lightweight analyzer: try to find relevant info (mint, eventType, timestamp)
function analyzeHeliusMessage(parsed: any) {
  if (!parsed) return null;
  // Helius WS may deliver messages under params.result or result
  const obj = parsed.params?.result || parsed.result || parsed;
  // try to extract context.slot when present so callers can use slot->getBlockTime fallback
  const slotFromCtx = parsed?.params?.result?.context?.slot ?? parsed?.result?.context?.slot ?? parsed?.context?.slot ?? null;
  // First, if this is a logsNotification, inspect value.logs for initialize_mint or metadata creation
  try {
    const res = parsed.params?.result || parsed.result || parsed;
    const v = res.value || res; // sometimes nested
    // Consolidate logs sources: top-level logs, meta.logMessages, value.logs
    const logs: string[] = [];
    if (v && Array.isArray(v.logs)) logs.push(...v.logs.filter((x: any) => typeof x === 'string'));
    if (v && v.meta && Array.isArray(v.meta.logMessages)) logs.push(...v.meta.logMessages.filter((x: any) => typeof x === 'string'));

    // Helius logsNotification: inspect logs for explicit patterns and memo content
    if (logs.length) {
      for (const ln of logs) {
        if (typeof ln !== 'string') continue;
        const low = ln.toLowerCase();
        // common explicit patterns
        if (low.includes('initialize_mint') || low.includes('create_metadata') || low.includes('create metadata account') || low.includes('create_metadata_account')) {
          const m = ln.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
          if (m && m.length) return { mint: m[0], eventType: 'metadata_or_initialize', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
        }
        // memo program may include a raw mint in memo text or label
        if (low.includes('memo') || ln.includes('Memo') || ln.includes('memo:')) {
          const m = ln.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
          if (m && m.length) return { mint: m[0], eventType: 'memo', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
        }
        // sometimes labels like 'name: <mint>' or 'mint: <addr>' appear
  const labelMatch = ln.match(/(?:mint[:=]\s*|name[:=]\s*)([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  if (labelMatch && labelMatch[1]) return { mint: labelMatch[1], eventType: 'label', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
      }
    }

    // If Helius gives parsed inner instructions (meta.innerInstructions), search there first
    if (v && v.meta && Array.isArray(v.meta.innerInstructions)) {
      for (const block of v.meta.innerInstructions) {
        if (!block || !Array.isArray(block.instructions)) continue;
        for (const ins of block.instructions) {
          try {
            if (ins.parsed && typeof ins.parsed === 'object') {
              const info = ins.parsed.info || ins.parsed;
              if (info && typeof info === 'object') {
                const cand = info.mint || info.token || info.mintAddress || info.account || info.destination || info.source || null;
                if (typeof cand === 'string' && cand.length >= 32 && cand.length <= 44) return { mint: cand, eventType: 'inner_parsed', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
                // sometimes 'mint' appears nested inside other objects
                if (info.postTokenBalances && Array.isArray(info.postTokenBalances)) {
                  for (const b of info.postTokenBalances) {
                    if (b && typeof b.mint === 'string' && b.mint.length >= 32 && b.mint.length <= 44) return { mint: b.mint, eventType: 'postTokenBalance', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
                  }
                }
              }
            }
          } catch (e) {}
        }
      }
    }

    // Broadened scan of transaction.message.instructions (incl. parsed forms)
    if (v && v.transaction && v.transaction.message && Array.isArray(v.transaction.message.instructions)) {
      for (const ins of v.transaction.message.instructions) {
        try {
          if (ins.parsed && typeof ins.parsed === 'object') {
            const t = (ins.parsed.type || ins.parsed.instruction || '') + '';
            const info = ins.parsed.info || ins.parsed;
            if (info && typeof info === 'object') {
              const cand = info.mint || info.token || info.mintAddress || info.account || info.destination || info.source || null;
              if (typeof cand === 'string' && cand.length >= 32 && cand.length <= 44) return { mint: cand, eventType: 'parsed_instruction', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
              if (info.postTokenBalances && Array.isArray(info.postTokenBalances)) {
                for (const b of info.postTokenBalances) {
                  if (b && typeof b.mint === 'string' && b.mint.length >= 32 && b.mint.length <= 44) return { mint: b.mint, eventType: 'postTokenBalance', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
                }
              }
            }
          }
          // scan accounts field
          if (ins.accounts && Array.isArray(ins.accounts)) {
            for (const a of ins.accounts) {
              if (typeof a === 'string' && a.length >= 32 && a.length <= 44) {
                return { mint: a, eventType: 'account_ref', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  // Fallback: recursive search for base58-like substrings anywhere in the message
  const found: Record<string, any> = {};
  function walk(o: any, depth = 0) {
    if (!o || depth > 10) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) {
        try {
          const v2 = o[k];
          if ((k === 'mint' || k === 'token' || k === 'mintAddress' || k === 'account') && typeof v2 === 'string' && v2.length >= 32 && v2.length <= 44) found.mint = v2;
          // try to detect token fields inside nested objects
          if (k.toLowerCase().includes('mint') && typeof v2 === 'string' && v2.length >= 32 && v2.length <= 44) found.mint = v2;
          walk(v2, depth + 1);
        } catch (e) {}
      }
    } else if (typeof o === 'string') {
      const m = o.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
      if (m && m.length) found.candidate = found.candidate || m[0];
    }
  }
  walk(obj);
  const mint = found.mint || found.candidate || null;
  if (!mint) return null;
  return { mint, eventType: 'fallback_recursive', detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), firstSlot: slotFromCtx ?? null, raw: parsed };
}

// Compute a simple confidence score (0..1) for an analyzed event.
// Heuristics:
// - metadata_or_initialize -> 1.0
// - inner_parsed / parsed_instruction / postTokenBalance -> 0.9
// - label -> 0.5
// - memo -> 0.2
// - fallback_recursive -> 0.15
function computeEventConfidence(evt: any, raw: any) {
  try {
    if (!evt || typeof evt !== 'object') return 0;
    const t = evt.eventType || '';
    if (t === 'metadata_or_initialize') return 1.0;
    if (t === 'inner_parsed' || t === 'parsed_instruction' || t === 'postTokenBalance') return 0.9;
    if (t === 'label') return 0.5;
    if (t === 'memo') return 0.2;
    if (t === 'fallback_recursive') return 0.15;
    // bonus if parsed.transaction contains innerInstructions with mint-like fields
    try {
      const res = raw?.params?.result || raw?.result || raw;
      const v = res?.value || res;
      if (v && v.meta && Array.isArray(v.meta.innerInstructions)) return 0.85;
    } catch (e) {}
    return 0.1;
  } catch (e) { return 0; }
}

// Helper to expose recent events without keeping the instance around
let _lastInstance: any = null;
function saveLastInstance(inst: any) { _lastInstance = inst; }
function getRecentHeliusEvents() { try { return _lastInstance ? _lastInstance.getRecentEvents() : []; } catch { return []; } }
export { getRecentHeliusEvents, saveLastInstance };

// If run directly, start and subscribe to generic notifications and exit on SIGINT
if (require.main === module) {
  (async () => {
    const instance = await startHeliusWebsocketListener({
      onOpen: () => console.log('Listener started (direct run)'),
  onMessage: (m) => { try { const s = typeof m === 'string' ? m.slice(0,120) : JSON.stringify(m || '').slice(0,120); console.log('WS message sample:', s); } catch (e) { console.log('WS message sample: <unserializable>'); } },
      onClose: () => process.exit(0),
      onError: (e) => {
        console.error('WS error (direct run):', e?.message || e);
        process.exit(1);
      },
    });

    process.on('SIGINT', async () => {
      console.log('Stopping Helius WS listener...');
      await instance.stop();
      process.exit(0);
    });
  })();
}
