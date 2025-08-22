import 'dotenv/config';
import axios from 'axios';
import { fetchLatest5FromAllSources } from '../src/fastTokenFetcher';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

function maskKey(url?: string | null) {
  if (!url) return url;
  return url.replace(/(api[-_]?key)=([^&\s]+)/i, '$1=***');
}

async function run() {
  const env = process.env;
  const sources = {
    DEX_BOOSTS: env.DEXSCREENER_API_ENDPOINT_BOOSTS || env.DEXSCREENER_API_ENDPOINT_BOOSTS,
    DEX_SEARCH: env.DEXSCREENER_API_ENDPOINT_SEARCH,
    HELIUS_RPC_URL: env.HELIUS_RPC_URL,
    HELIUS_WS_URL_RAW: env.HELIUS_WS_URL_RAW || env.HELIUS_WEBSOCKET_URL,
    HELIUS_PARSE_HISTORY_URL: env.HELIUS_PARSE_HISTORY_URL,
  HELIUS_PARSE_TX_URL: env.HELIUS_PARSE_TX_URL || null,
  HELIUS_FAST_RPC_URL: env.HELIUS_FAST_RPC_URL || null,
    SOLSCAN_API_URL: env.SOLSCAN_API_URL,
    MAINNET_RPC: env.MAINNET_RPC || env.HELIUS_RPC_URL,
  };

  // Simple CLI parsing: --duration=<seconds>, --ndjson=<path>, --no-ws, --verbose
  const argv = process.argv.slice(2);
  function getArg(name: string) {
    const p = argv.find(a => a.startsWith(`${name}=`));
    if (p) return p.split('=')[1];
    return null;
  }
  function hasFlag(name: string) { return argv.includes(name); }
  const durationArg = getArg('--duration');
  const durationSeconds = durationArg ? (parseInt(durationArg, 10) || 0) : 0;
  const ndjsonArg = getArg('--ndjson');
  const noWs = hasFlag('--no-ws');
  const verbose = hasFlag('--verbose');

  console.log('Sources found (masked):');
  for (const k of Object.keys(sources)) {
    // @ts-ignore
    console.log(`- ${k}:`, maskKey(sources[k]));
  }

  if (verbose) console.log('CLI options:', { durationSeconds, ndjsonArg, noWs, verbose });

  // prepare logs directory and NDJSON
  const LOG_DIR = path.resolve(process.cwd(), 'logs', 'raw_sources');
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch(e) {}
  const NDJSON_FILE = ndjsonArg ? path.resolve(process.cwd(), ndjsonArg) : path.join(LOG_DIR, 'full_raw.ndjson');
  function writeNd(obj: any) { try { fs.appendFileSync(NDJSON_FILE, JSON.stringify(obj) + '\n'); } catch(e){ console.error('ndjson write err', e && e.message);} }

  // 1) DexScreener boosts
  try {
    const url = sources.DEX_BOOSTS;
    if (url) {
      console.log('\nFetching DexScreener boosts (sample)...');
      const res = await axios.get(url, { timeout: 5000 });
      const data = res.data;
      console.log('DexScreener boosts type:', Array.isArray(data) ? 'array' : typeof data);
      if (Array.isArray(data)) {
        console.log('Dex boosts sample (first 5):', JSON.stringify(data.slice(0,5), null, 2));
        // write full raw items to NDJSON
        data.forEach((it: any) => writeNd({ ts: Date.now(), source: 'dex_boosts', item: it }));
      }
      else console.log('Dex boosts raw keys:', Object.keys(data).slice(0,10));
    } else console.log('\nNo DexScreener boosts URL in .env');
  } catch (e: any) {
    console.error('\nDexScreener fetch error:', e.message || e);
  }

  // 2) fetchLatest5FromAllSources from our fastTokenFetcher
  try {
    console.log('\nCalling fetchLatest5FromAllSources(50) ...');
    const latest = await fetchLatest5FromAllSources(50 as any);
    console.log('fetchLatest5FromAllSources result keys:', Object.keys(latest));
    console.log('heliusEvents sample:', latest.heliusEvents?.slice(0,10));
    console.log('dexTop sample:', latest.dexTop?.slice(0,10));
    console.log('heliusHistory sample:', latest.heliusHistory?.slice(0,10));
  // write unified raw
  writeNd({ ts: Date.now(), source: 'fastTokenFetcher', data: latest });
  } catch (e: any) {
    console.error('\nfastTokenFetcher error:', e && e.message);
  }

  // 3) Helius parse-history for first dexTop candidate
  try {
    const latest = await fetchLatest5FromAllSources(50 as any);
    const dexTop = latest.dexTop || [];
    if (dexTop.length && sources.HELIUS_PARSE_HISTORY_URL) {
      // pick first dexTop candidate that looks like a Solana address (avoid 0x ETH/BSC addresses)
      const addr = dexTop.find((a: string) => !a.startsWith('0x') && a.length > 30) || dexTop[0];
      const url = sources.HELIUS_PARSE_HISTORY_URL.replace('{address}', encodeURIComponent(addr));
      console.log('\nCalling Helius parse-history for', addr, '->', maskKey(url));
      const res = await axios.get(url, { timeout: 5000 });
      console.log('Helius parse-history response keys:', Object.keys(res.data || {}).slice(0,10));
      if (Array.isArray(res.data)) {
        console.log('first entries (sample):', JSON.stringify(res.data.slice(0,3), null, 2));
        // write each entry to NDJSON and optionally fetch tx parse
        res.data.forEach((entry: any) => {
          writeNd({ ts: Date.now(), source: 'parse_history', address: addr, entry });
          if (sources.HELIUS_PARSE_TX_URL && entry.signature) {
            try {
              const txUrl = sources.HELIUS_PARSE_TX_URL.replace('{signature}', encodeURIComponent(entry.signature));
              axios.get(txUrl, { timeout: 5000 }).then(txRes=> writeNd({ ts: Date.now(), source: 'parse_tx', signature: entry.signature, data: txRes.data })).catch(()=>{});
            } catch(e){}
          }
        });
      } else {
        console.log('parse-history sample:', JSON.stringify(res.data, null, 2));
        writeNd({ ts: Date.now(), source: 'parse_history', address: addr, entry: res.data });
      }
    } else console.log('\nNo dexTop candidates or no HELIUS_PARSE_HISTORY_URL available');
  } catch (e: any) {
    console.error('\nHelius parse-history error:', e && (e.message || e));
  }

  // 4) RPC getVersion on HELIUS_RPC_URL / MAINNET_RPC
  async function rpcGetVersion(rpcUrl?: string | null, name = 'RPC') {
    if (!rpcUrl) return console.log(`\n${name} URL not provided.`);
    try {
      console.log(`\nCalling ${name} getVersion ->`, maskKey(rpcUrl));
      const res = await axios.post(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'getVersion', params: [] }, { timeout: 5000 });
      console.log(`${name} getVersion result:`, res.data && res.data.result ? res.data.result : Object.keys(res.data || {}).slice(0,5));
    } catch (e: any) {
      console.error(`${name} RPC error:`, e && (e.message || e));
    }
  }

  await rpcGetVersion(sources.HELIUS_RPC_URL, 'HELIUS_RPC_URL');
  await rpcGetVersion(sources.MAINNET_RPC, 'MAINNET_RPC');
  // fast RPC if available
  await rpcGetVersion(sources.HELIUS_FAST_RPC_URL, 'HELIUS_FAST_RPC_URL');

  // 5) WebSocket persistent connect to HELIUS_WS_URL_RAW — keep listening and auto-reconnect
  try {
    const wsUrl = sources.HELIUS_WS_URL_RAW;
    if (noWs) { console.log('\n--no-ws set, skipping websocket connection'); }
    else if (!wsUrl) { console.log('\nNo HELIUS_WS_URL_RAW provided'); } else {
      console.log('\nStarting persistent websocket (masked):', maskKey(wsUrl));
      let socket: WebSocket | null = null;
      let manuallyClosed = false;
      function connectWs() {
  socket = new WebSocket(wsUrl as string, { handshakeTimeout: 10000 });
        socket.on('open', () => { console.log(new Date().toISOString(), 'WS open'); writeNd({ ts: Date.now(), source: 'ws_event', event: 'open' }); });
        socket.on('message', (msg) => {
          try {
            const s = msg.toString();
            // write full raw (capped to reasonable length) to NDJSON and console truncated
            writeNd({ ts: Date.now(), source: 'ws', raw: s });
            console.log(new Date().toISOString(), 'WS message (truncated):', s.slice(0,800));
          } catch (e) { console.error('WS message handling error', e && e.message); }
        });
        socket.on('error', (err) => { console.error(new Date().toISOString(), 'WS error:', err && err.message); writeNd({ ts: Date.now(), source: 'ws_event', event: 'error', message: err && err.message }); });
        socket.on('close', (code, reason) => {
          writeNd({ ts: Date.now(), source: 'ws_event', event: 'close', code, reason: reason && reason.toString() });
          console.log(new Date().toISOString(), `WS closed code=${code} reason=${reason?.toString()}`);
          if (!manuallyClosed) {
            // reconnect after short delay
            setTimeout(() => {
              console.log(new Date().toISOString(), 'Reconnecting WS...');
              connectWs();
            }, 3000);
          }
        });
      }
      connectWs();

      // graceful shutdown
      function gracefulExit(code = 0) {
        console.log('Exiting — closing WS if open');
        manuallyClosed = true;
        try { socket && socket.close(); } catch(e) {}
        process.exit(code);
      }
      process.on('SIGINT', () => gracefulExit(0));
      // if durationSeconds provided, schedule an exit
      if (durationSeconds > 0) {
        setTimeout(() => {
          console.log(`Duration ${durationSeconds}s elapsed — shutting down`);
          gracefulExit(0);
        }, durationSeconds * 1000);
      }
    }
  } catch (e: any) {
    console.error('WebSocket persistent error:', e && e.message);
  }

  // SOLSCAN lookups for dexTop
  try {
    if (sources.SOLSCAN_API_URL) {
      const latest2 = await fetchLatest5FromAllSources(20 as any);
      const addresses = (latest2.dexTop || []).filter((a:any)=>typeof a==='string' && !a.startsWith('0x')).slice(0,10);
      for (const addr of addresses) {
        try {
          // try multiple candidate endpoints for Solscan — vendors vary
          const base = sources.SOLSCAN_API_URL.replace(/\/$/, '');
          const candidates = [
            `${base}/account/tokens?address=${encodeURIComponent(addr)}`,
            `${base}/account/tokens?account=${encodeURIComponent(addr)}`,
            `${base}/token/meta?tokenAddress=${encodeURIComponent(addr)}`,
            `${base}/token/holders?tokenAddress=${encodeURIComponent(addr)}`,
            `${base}/token/account?address=${encodeURIComponent(addr)}`
          ];
          let ok = false;
          for (const tryUrl of candidates) {
            try {
              const res = await axios.get(tryUrl, { timeout: 5000 });
              if (res && (res.status === 200) && res.data) {
                console.log('\nSolscan candidate succeeded for', addr, '->', tryUrl);
                writeNd({ ts: Date.now(), source: 'solscan', addr, url: tryUrl, data: res.data });
                ok = true; break;
              }
            } catch(e:any) {
              // ignore and try next
            }
          }
          if (!ok) {
            // fallback: use RPC getAccountInfo via MAINNET_RPC or HELIUS_RPC_URL
            const rpcUrl = sources.MAINNET_RPC || sources.HELIUS_RPC_URL;
            if (rpcUrl) {
              try {
                const rpcRes = await axios.post(rpcUrl, { jsonrpc: '2.0', id:1, method: 'getAccountInfo', params: [addr, { encoding: 'jsonParsed' }] }, { timeout: 8000 });
                writeNd({ ts: Date.now(), source: 'rpc_getAccountInfo', rpcUrl: rpcUrl, addr, data: rpcRes.data });
                console.log('\nRPC getAccountInfo fallback for', addr, 'status:', rpcRes.status || 'ok');
              } catch(e:any) {
                console.error('RPC getAccountInfo error for', addr, e && e.message);
                writeNd({ ts: Date.now(), source: 'rpc_getAccountInfo_error', addr, error: e && e.message });
              }
            } else {
              console.log('No RPC available for fallback for', addr);
            }
          }
        } catch(e:any){ console.error('Solscan query error for', addr, e && e.message); }
      }
    }
  } catch(e:any){ }

  // if no websocket and durationSeconds provided, schedule exit after finishing lookups
  if (noWs && durationSeconds > 0) {
    setTimeout(() => {
      console.log(`--no-ws run: duration ${durationSeconds}s elapsed — exiting`);
      process.exit(0);
    }, durationSeconds * 1000);
  }
}

run().then(()=>console.log('\nDone.')).catch(err=>console.error('Fatal:', err && err.message));
