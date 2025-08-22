import 'dotenv/config';
import axios from 'axios';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fetchLatest5FromAllSources } from '../src/fastTokenFetcher';

const LOG_DIR = path.resolve(process.cwd(), 'logs', 'raw_sources');
fs.mkdirSync(LOG_DIR, { recursive: true });

function nowIso() { return new Date().toISOString(); }
function writeLog(file: string, data: any) {
  try {
    fs.appendFileSync(path.join(LOG_DIR, file), data + '\n');
  } catch (e) {
    console.error('writeLog error', e && e.message);
  }
}

const env = process.env;
const sources = {
  DEX_BOOSTS: env.DEXSCREENER_API_ENDPOINT_BOOSTS || env.DEXSCREENER_API_ENDPOINT_BOOSTS || null,
  DEX_SEARCH: env.DEXSCREENER_API_ENDPOINT_SEARCH || null,
  HELIUS_RPC_URL: env.HELIUS_RPC_URL || null,
  HELIUS_WS_URL_RAW: env.HELIUS_WS_URL_RAW || env.HELIUS_WEBSOCKET_URL || null,
  HELIUS_PARSE_HISTORY_URL: env.HELIUS_PARSE_HISTORY_URL || null,
  SOLSCAN_API_URL: env.SOLSCAN_API_URL || null,
  MAINNET_RPC: env.MAINNET_RPC || null,
};

console.log('Starting live aggregator — sources from .env:');
Object.entries(sources).forEach(([k, v]) => console.log(`${k}: ${v ? v : '---missing---'}`));
writeLog('summary.log', `${nowIso()} START sources: ${JSON.stringify(sources)}`);

// WebSocket listener
let ws: WebSocket | null = null;
function startWs() {
  const url = sources.HELIUS_WS_URL_RAW;
  if (!url) { console.warn('No HELIUS_WS_URL_RAW provided — skipping WS'); return; }
  try {
    ws = new WebSocket(url, { handshakeTimeout: 10000 });
    ws.on('open', () => {
      const msg = `${nowIso()} WS open`;
      console.log(msg);
      writeLog('ws.log', msg);
    });
    ws.on('message', (msg) => {
      try {
        const s = msg.toString();
        // attempt parse
        let parsed: any = s;
        try { parsed = JSON.parse(s); } catch(e) {}
        const out = `${nowIso()} WS message: ${JSON.stringify(parsed, null, 2)}`;
        console.log(out);
        writeLog('ws.log', out);
      } catch (e) {
        console.error('WS message handling error', e && e.message);
      }
    });
    ws.on('error', (err) => {
      const m = `${nowIso()} WS error: ${err && err.message}`;
      console.error(m);
      writeLog('ws.log', m);
    });
    ws.on('close', (code, reason) => {
      const m = `${nowIso()} WS close code=${code} reason=${reason?.toString()}`;
      console.log(m);
      writeLog('ws.log', m);
      // auto-reconnect after short delay
      setTimeout(() => startWs(), 3000);
    });
  } catch (e:any) {
    console.error('startWs error', e && e.message);
  }
}

startWs();

// Periodic fetcher
const POLL_MS = Number(env.LIVE_AGGREGATOR_POLL_MS || '15000');

async function fetchDexBoosts() {
  const url = sources.DEX_BOOSTS;
  if (!url) return;
  try {
    const r = await axios.get(url, { timeout: 8000 });
    const out = { ts: nowIso(), source: 'dex_boosts', url, data: r.data };
    console.log(nowIso(), 'Dex boosts fetched — items:', Array.isArray(r.data) ? r.data.length : '??');
    writeLog('dex_boosts.log', JSON.stringify(out, null, 2));
    // print full raw items to console as requested
    if (Array.isArray(r.data)) {
      r.data.forEach((it: any, i:number) => console.log(`DEX[${i}]:`, JSON.stringify(it, null, 2)));
    } else console.log('Dex boosts raw:', JSON.stringify(r.data, null, 2));
  } catch (e:any) {
    console.error('Dex boosts fetch error', e && e.message);
    writeLog('dex_boosts.log', `${nowIso()} ERROR ${e && e.message}`);
  }
}

async function fetchUnifiedAndParse() {
  try {
    const latest = await fetchLatest5FromAllSources(100 as any);
    const out = { ts: nowIso(), source: 'fastTokenFetcher', data: latest };
    writeLog('fast_fetcher.log', JSON.stringify(out, null, 2));
    console.log(nowIso(), 'fastTokenFetcher result keys:', Object.keys(latest));
    // print full dexTop
    if (Array.isArray(latest.dexTop)) {
      latest.dexTop.forEach((a:any,i:number) => console.log(`DEX_TOP[${i}]:`, a));
    }

    // For parse-history: query first several solana-like addresses
    if (sources.HELIUS_PARSE_HISTORY_URL && Array.isArray(latest.heliusHistory)) {
      const candidates = latest.heliusHistory.filter((a:any) => typeof a === 'string' && !a.startsWith('0x'));
      for (let i=0;i<Math.min(5, candidates.length);i++){
        const addr = candidates[i];
        const url = sources.HELIUS_PARSE_HISTORY_URL.replace('{address}', encodeURIComponent(addr));
        try{
          const res = await axios.get(url, { timeout: 8000 });
          console.log(nowIso(), `parse-history ${addr} entries:`, Array.isArray(res.data)? res.data.length : '??');
          writeLog('parse_history.log', JSON.stringify({ts: nowIso(), addr, data: res.data}, null, 2));
          // print raw full
          if (Array.isArray(res.data)) res.data.forEach((entry:any,idx:number)=> console.log(`PARSE ${addr}[${idx}]:`, JSON.stringify(entry, null, 2)));
          else console.log('PARSE raw:', JSON.stringify(res.data, null, 2));
        }catch(e:any){
          console.error('parse-history error for', addr, e && e.message);
          writeLog('parse_history.log', `${nowIso()} ERROR ${addr} ${e && e.message}`);
        }
      }
    }
  } catch (e:any) {
    console.error('fetchUnifiedAndParse error', e && e.message);
    writeLog('fast_fetcher.log', `${nowIso()} ERROR ${e && e.message}`);
  }
}

let runs = 0;
async function pollOnce() {
  runs++;
  console.log('\n', nowIso(), `POLL #${runs}`);
  writeLog('summary.log', `${nowIso()} POLL ${runs}`);
  await Promise.all([fetchDexBoosts(), fetchUnifiedAndParse()]);
}

const INTERVAL = setInterval(pollOnce, POLL_MS);
// run immediate
pollOnce();

// Optional run duration for demo
const RUN_MS = Number(env.RUN_DURATION_MS || '0');
if (RUN_MS>0) {
  console.log(`Will run for ${RUN_MS}ms then exit (demo mode)`);
  setTimeout(()=>{
    clearInterval(INTERVAL);
    console.log('Demo duration ended — closing WS and exiting');
    if (ws) ws.close();
    process.exit(0);
  }, RUN_MS);
}
