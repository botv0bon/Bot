import dotenv from 'dotenv';
dotenv.config();

// Minimal safe Helius WebSocket listener.
// - Uses `HELIUS_WEBSOCKET_URL` and `HELIUS_API_KEY` from .env if available
// - If `HELIUS_USE_WEBSOCKET` is not set or false, the module exports a no-op starter
// - Designed to be imported and started from other services

const HELIUS_WS_URL = process.env.HELIUS_WEBSOCKET_URL || process.env.HELIUS_FAST_RPC_URL || '';
const USE_WS = (process.env.HELIUS_USE_WEBSOCKET || 'false').toLowerCase() === 'true';
const SUBSCRIBE_METADATA = (process.env.HELIUS_SUBSCRIBE_METADATA || 'true').toLowerCase() === 'true';
const SUBSCRIBE_SPLTOKEN = (process.env.HELIUS_SUBSCRIBE_SPLTOKEN || 'true').toLowerCase() === 'true';

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
      options?.onMessage && options.onMessage(parsed);
      // try to extract candidate mint addresses or metadata events
      try {
        const evt = analyzeHeliusMessage(parsed);
        if (evt) {
          pushEvent(evt);
          try { options?.onMessage && options.onMessage(parsed); } catch {}
          try { if ((options as any)?.onNewMint) (options as any).onNewMint(evt); } catch (e) {}
        }
      } catch (e) {}
    } catch (err) {
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
    getRecentEvents: () => recentEvents.slice(),
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
  // First, if this is a logsNotification, inspect value.logs for initialize_mint or metadata creation
  try {
    const res = parsed.params?.result || parsed.result || parsed;
    const v = res.value || res; // sometimes nested
    // Helius logsNotification: v.logs is array of program log strings
    if (v && Array.isArray(v.logs)) {
      // look for lines mentioning 'initialize_mint' or 'Create Metadata' or base58 pubkeys
      for (const ln of v.logs) {
        if (typeof ln !== 'string') continue;
        // detect explicit instruction names
        if (ln.toLowerCase().includes('initialize_mint') || ln.toLowerCase().includes('create_metadata')) {
          // try to extract any base58-looking token after the log line
          const m = ln.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
          if (m && m.length) {
            return { mint: m[0], detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), raw: parsed };
          }
        }
      }
    }

    // If Helius gives parsed inner instructions, search there
    if (v && v.transaction && v.transaction.message && Array.isArray(v.transaction.message.instructions)) {
      for (const ins of v.transaction.message.instructions) {
        try {
          // parsed instructions often have 'parsed' object with info
          if (ins.parsed && typeof ins.parsed === 'object') {
            // SPL Token initializeMint sometimes in parsed.type
            const t = ins.parsed.type || ins.parsed.instruction || '';
            if (typeof t === 'string' && (t.toLowerCase().includes('initialize') || t.toLowerCase().includes('mint'))) {
              // check accounts or info for mint
              const info = ins.parsed.info || ins.parsed;
              if (info && typeof info === 'object') {
                const cand = info.mint || info.token || info.mintAddress || info.account || null;
                if (typeof cand === 'string' && cand.length >= 32 && cand.length <= 44) return { mint: cand, detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), raw: parsed };
              }
            }
          }
          // otherwise try scanning instruction accounts for base58-like strings
          if (ins.accounts && Array.isArray(ins.accounts)) {
            for (const a of ins.accounts) {
              if (typeof a === 'string' && a.length >= 32 && a.length <= 44) {
                return { mint: a, detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), raw: parsed };
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  // Fallback: recursive search for base58-like substrings anywhere in the message
  const found: Record<string, any> = {};
  function walk(o: any) {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) {
        try {
          const v2 = o[k];
          if (k === 'mint' && typeof v2 === 'string' && v2.length >= 32 && v2.length <= 44) found.mint = v2;
          walk(v2);
        } catch (e) {}
      }
    } else if (typeof o === 'string') {
      const m = o.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
      if (m && m.length) found.candidate = m[0];
    }
  }
  walk(obj);
  const mint = found.mint || found.candidate || null;
  if (!mint) return null;
  return { mint, detectedAt: new Date().toISOString(), detectedAtSec: Math.floor(Date.now()/1000), raw: parsed };
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
      onMessage: (m) => console.log('WS message sample:', JSON.stringify(m).slice(0, 120)),
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
