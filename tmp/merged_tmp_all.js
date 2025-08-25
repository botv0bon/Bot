// Merged temporary scripts - generated automatically
// Source files merged:
// - tmp_dump_params.js
// - tmp_helius_program_subscribe.js
// - tmp_helius_mint_inspect.js
// - tmp_call_handle.js
// - tmp_get_parsed_tx_timestamps.js
// - tmp_mint_timestamps.js
// - tmp_helius_ws_test.js
// - tmp_call_handle_ts.ts
// - run_quick_discovery.js (tmp/)
// - quick_discovery.ts (tmp/)

// NOTE: this file is an archive of temporary scripts. It's intentionally
// non-runnable as a single program — it's meant to keep the scripts together
// for reference. To run an individual script, extract its section into its
// own file.

// --- begin: tmp_dump_params.js ---

const fs_merged_1 = require('fs');
const WebSocket_merged_1 = require('ws');

function readEnv_merged_1() {
  const raw = fs_merged_1.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) { const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0,i); const v = l.slice(i+1); map[k]=v; }
  return map;
}

(async function(){
  const env = readEnv_merged_1();
  const url = env.HELIUS_WEBSOCKET_URL;
  if(!url){ console.error('HELIUS_WEBSOCKET_URL missing'); process.exit(1); }
  const ws = new WebSocket_merged_1(url);
  const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  let count=0; let printed=0; const MAX_PRINT=50;
  ws.on('open', ()=>{
    console.log('open'); ws.send(JSON.stringify({ jsonrpc:'2.0', id:1, method:'programSubscribe', params:[TOKEN_PROG, { encoding:'jsonParsed', commitment:'confirmed' }] }));
    setTimeout(()=>{ console.log('done timeout'); ws.close(); process.exit(0); }, 20000);
  });
  ws.on('message', m=>{
    count++;
    try{
      const j = JSON.parse(m.toString());
      const params = j.params || {};
      if(params.result){
        if(printed<MAX_PRINT){
          console.log('\n--- NOTIF', printed+1, '---');
          console.log(JSON.stringify(params.result, null, 2).slice(0,8000));
          printed++;
        }
      }
    }catch(e){}
  });
  ws.on('error', e=>{ console.error('ws err', e && e.message); process.exit(2); });
})();

// --- end: tmp_dump_params.js ---


// --- begin: tmp_helius_program_subscribe.js ---

const fs_merged_2 = require('fs');
const WebSocket_merged_2 = require('ws');

function readEnv_merged_2() {
  const raw = fs_merged_2.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) { const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0, i); const v = l.slice(i + 1); map[k] = v; }
  return map;
}

(async function main(){
  try {
    const env = readEnv_merged_2();
    const url = env.HELIUS_WEBSOCKET_URL;
    if (!url) { console.error('HELIUS_WEBSOCKET_URL not found in .env'); process.exit(1); }
    const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    console.log('connecting to', url.replace(/(\?|&)?api-key=[^&]+/, '?api-key=***'));
    const ws = new WebSocket_merged_2(url);
    let cnt = 0;
    let notifications = 0;

    ws.on('open', () => {
      console.log('WS open');
      const msg = { jsonrpc: '2.0', id: 1, method: 'programSubscribe', params: [TOKEN_PROG, { encoding: 'jsonParsed', commitment: 'confirmed' }] };
      console.log('sending subscribe', JSON.stringify(msg));
      ws.send(JSON.stringify(msg));

      setTimeout(() => {
        ws.close();
        console.log('WS closed, messages=', cnt, 'notifications=', notifications);
        process.exit(0);
      }, 15000);
    });

    ws.on('message', (m) => {
      cnt++;
      const s = m.toString();
      try {
        const j = JSON.parse(s);
        if (j.result && typeof j.result === 'number') { console.log('subscribed id=', j.result); return; }
        if (j.method && j.method.includes('program')) {
          notifications++;
          const params = j.params || {};
          const res = params.result || {};
          const acc = res?.account || res?.value || {};
          const parsed = res?.value?.data || acc?.data || undefined;
          const summary = {msgIndex: cnt, method: j.method, subscription: params.subscription || null};
          if (res?.context) summary.slot = res.context.slot;
          if (res?.value && res.value?.account) summary.accountKey = (res.value.account?.pubkey || '').slice(0,8);
          if (Array.isArray(res?.value?.data)) summary.dataLen = res.value.data.length;
          console.log(JSON.stringify(summary));
          return;
        }
        const info = { msgIndex: cnt, keys: Object.keys(j).slice(0,6) };
        console.log(JSON.stringify(info));
      } catch (e) { console.log('raw', s.slice(0,400)); }
    });

    ws.on('error', (e) => { console.error('ws error', e && e.message); process.exit(2); });
  } catch (err) { console.error('failed to start', err && err.message); process.exit(3); }
})();

// --- end: tmp_helius_program_subscribe.js ---


// --- begin: tmp_helius_mint_inspect.js ---

const fs_merged_3 = require('fs');
const WebSocket_merged_3 = require('ws');
const axios_merged_3 = require('axios').default || require('axios');

function readEnv_merged_3() { const raw = fs_merged_3.readFileSync('.env', 'utf8'); const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); const map = {}; for (const l of lines) { const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0, i); const v = l.slice(i + 1); map[k] = v; } return map; }

function scrubKey_merged_3(url){ return url ? url.replace(/(\?|&)?api-key=[^&]+/,'?api-key=***') : url; }

(async function main(){
  try{
    const env = readEnv_merged_3();
    const url = env.HELIUS_WEBSOCKET_URL;
    const parseHistoryTemplate = env.HELIUS_PARSE_HISTORY_URL || env.HELIUS_PARSE_HISTORY;
    if(!url) { console.error('HELIUS_WEBSOCKET_URL not set'); process.exit(1); }
    console.log('connecting to', scrubKey_merged_3(url));
    const ws = new WebSocket_merged_3(url);
    const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const foundMints = new Map();
    let notifCount=0;

    ws.on('open', ()=>{
      console.log('WS open');
      const msg = { jsonrpc: '2.0', id: 1, method: 'programSubscribe', params: [TOKEN_PROG, { encoding: 'jsonParsed', commitment: 'confirmed' }] };
      ws.send(JSON.stringify(msg));
      console.log('subscribed programSubscribe TOKEN program; collecting notifications for 20s...');
      setTimeout(()=>{
        ws.close();
        console.log('WS closed; collected', foundMints.size, 'unique candidate mints; total notifications=', notifCount);
        let i=0;
        for(const [mint, v] of foundMints){ if(i>=50) break; console.log('MINT', i+1, mint, JSON.stringify(v).slice(0,600)); i++; }
        (async ()=>{
          const toCheck = Array.from(foundMints.keys()).slice(0,10);
          if(!parseHistoryTemplate || toCheck.length===0){ process.exit(0); }
          console.log('\nFetching parse-history for first', toCheck.length, 'mints to get timestamps (this may be slow)...');
          for(const m of toCheck){
            try{
              const urlHist = parseHistoryTemplate.replace('{address}', m);
              const r = await axios_merged_3.get(urlHist, { timeout: 10000 });
              const body = r.data;
              if(Array.isArray(body) && body.length>0){ const first = body[0]; console.log('parse-history', m, 'txs=', body.length, 'firstSig=', first.signature, 'slot=', first.slot, 'ts=', first.blockTime || null); } else { console.log('parse-history', m, 'no txs'); }
            }catch(err){ console.log('parse-history', m, 'error', err && err.message); }
          }
          process.exit(0);
        })();
      }, 20000);
    });

    ws.on('message', (m)=>{
      notifCount++;
      const s = m.toString();
      let j; try{ j = JSON.parse(s); }catch(e){ return; }
      const params = j.params || {};
      const res = params.result || {};
      const val = res.value || res.account || res;
      let candidate = null; let evidence = null;
      try{
        const parsed = val.data && val.data.parsed ? val.data.parsed : val.data && Array.isArray(val.data) ? (val.data[1] && val.data[1].parsed) : (val.parsed || null);
        if(parsed && parsed.info && parsed.info.mint){ candidate = parsed.info.mint; evidence = {type:'tokenAccount', hostPubkey: val.pubkey || res.value && res.value.account && res.value.account.pubkey || null, parsedInfo: parsed.info}; }
        else if(parsed && parsed.type === 'mint'){ candidate = val.pubkey || res.value && res.value.account && res.value.account.pubkey || null; evidence = {type:'mintAccount', parsedInfo: parsed.info}; }
      }catch(e){}
      if(!candidate){ try{ if(val.account && val.account.data && val.account.data.parsed && val.account.data.parsed.info && val.account.data.parsed.info.mint){ candidate = val.account.data.parsed.info.mint; evidence = {type:'tokenAccount2', hostPubkey: val.pubkey || val.account && val.account.pubkey, parsedInfo: val.account.data.parsed.info}; } }catch(e){}
      }
      if(!candidate){ try{ const tx = j.result && j.result.transaction ? j.result.transaction : null; const msg = tx && tx.message ? tx.message : null; if(msg && msg.instructions && Array.isArray(msg.instructions)){ for(const ins of msg.instructions){ if(ins.parsed && ins.parsed.type){ const t = ins.parsed.type.toLowerCase(); if(t.includes('initialize') || t.includes('mint') || t.includes('create')){ if(ins.parsed.info && ins.parsed.info.mint) { candidate = ins.parsed.info.mint; evidence = {type:'parsedInstr', instrType:ins.parsed.type, parsedInfo:ins.parsed.info}; break; } } } } } }catch(e){} }
      if(candidate){ if(!foundMints.has(candidate)){ foundMints.set(candidate, {firstSlot: res.context && res.context.slot || null, evidence, sample: JSON.stringify(val).slice(0,1000)}); } }
    });

    ws.on('error', (e)=>{ console.error('ws error', e && e.message); process.exit(2); });
  }catch(err){ console.error('failed', err && err.message); process.exit(3); }
})();

// --- end: tmp_helius_mint_inspect.js ---


// --- begin: tmp_call_handle.js ---

(async () => {
  try {
    const ws = require('./src/heliusWsListener');
    const ff = require('./src/fastTokenFetcher');
    const evs = ws.getRecentHeliusEvents ? ws.getRecentHeliusEvents() : [];
    console.log('recent events count', evs.length);
    const withSlot = (evs || []).filter(e => e && (e.firstSlot || (e.raw && (e.raw.params && e.raw.params.result && e.raw.params.result.context && e.raw.params.result.context.slot))))
      .slice(0, 10);
    console.log('events with slot:', withSlot.length);
    for (const e of withSlot) {
      try {
        console.log('\nCalling handleNewMintEvent for', e.mint, 'firstSlot=', e.firstSlot || (e.raw && e.raw.params && e.raw.params.result && e.raw.params.result.context && e.raw.params.result.context.slot));
        const res = await ff.handleNewMintEvent(e, {}, null);
        console.log('result:', res);
      } catch (err) { console.error('call err', err && err.message ? err.message : err); }
    }
  } catch (e) { console.error('failed', e && e.message ? e.message : e); process.exit(1); }
})();

// --- end: tmp_call_handle.js ---


// --- begin: tmp_get_parsed_tx_timestamps.js ---

const fs_merged_6 = require('fs');
const WebSocket_merged_6 = require('ws');
const axios_merged_6 = require('axios').default || require('axios');

function readEnv_merged_6(){ const raw = fs_merged_6.readFileSync('.env','utf8'); const map = {}; raw.split(/\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#')).forEach(l=>{const i=l.indexOf('='); if(i===-1) return; const k=l.slice(0,i); map[k]=l.slice(i+1);}); return map; }

(async function(){
  const env = readEnv_merged_6();
  const url = env.HELIUS_WEBSOCKET_URL;
  const HELIUS_RPC = env.HELIUS_RPC_URL || env.HELIUS_FAST_RPC_URL || env.MAINNET_RPC;
  if(!url) { console.error('no HELIUS_WEBSOCKET_URL'); process.exit(1); }
  if(!HELIUS_RPC) { console.error('no RPC endpoint for getParsedTransaction'); process.exit(1); }
  const ws = new WebSocket_merged_6(url);
  const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  let sigs = new Set();
  ws.on('open', ()=>{ console.log('open'); ws.send(JSON.stringify({ jsonrpc:'2.0', id:1, method:'programSubscribe', params:[TOKEN_PROG, { encoding:'jsonParsed', commitment:'confirmed' }] })); setTimeout(async ()=>{ ws.close(); console.log('collected signatures', sigs.size); const list = Array.from(sigs).slice(0,10); for(const s of list){ try{ const body = { jsonrpc:'2.0', id:1, method:'getParsedTransaction', params:[s, 'confirmed'] }; const r = await axios_merged_6.post(HELIUS_RPC, body, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }); const data = r.data; const slot = data && data.result && data.result.slot; const ts = data && data.result && data.result.blockTime; console.log('sig', s.slice(0,8), 'slot=', slot, 'ts=', ts); }catch(err){ console.log('sig', s.slice(0,8), 'error', err && err.message); } } process.exit(0); }, 20000); });

  ws.on('message', m=>{
    try{ const j = JSON.parse(m.toString()); const params = j.params || {}; const res = params.result || {}; let sig = null; if(res.value && res.value.signature) sig = res.value.signature; if(!sig && res.signature) sig = res.signature; if(!sig && res.value && res.value.transaction && Array.isArray(res.value.transaction.signatures) && res.value.transaction.signatures[0]) sig = res.value.transaction.signatures[0]; if(!sig && res.transaction && Array.isArray(res.transaction.signatures) && res.transaction.signatures[0]) sig = res.transaction.signatures[0]; if(sig) sigs.add(sig); }catch(e){}
  });
  ws.on('error', e=>{ console.error('ws error', e && e.message); process.exit(2); });
})();

// --- end: tmp_get_parsed_tx_timestamps.js ---


// --- begin: tmp_mint_timestamps.js ---

const fs_merged_7 = require('fs');
const WebSocket_merged_7 = require('ws');
const axios_merged_7 = require('axios').default || require('axios');

function readEnv_merged_7() { const raw = fs_merged_7.readFileSync('.env', 'utf8'); const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); const map = {}; for (const l of lines) { const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0, i); const v = l.slice(i + 1); map[k] = v; } return map; }

function scrubKey_merged_7(url){ return url ? url.replace(/(\?|&)?api-key=[^&]+/,'?api-key=***') : url }

(async function main(){
  const env = readEnv_merged_7();
  const url = env.HELIUS_WEBSOCKET_URL;
  const parseHistoryTemplate = env.HELIUS_PARSE_HISTORY_URL || env.HELIUS_PARSE_HISTORY;
  const RPC = env.MAINNET_RPC || env.HELIUS_RPC_URL || env.HELIUS_FAST_RPC_URL || 'https://api.mainnet-beta.solana.com';
  if(!url) { console.error('HELIUS_WEBSOCKET_URL not set'); process.exit(1); }
  if(!RPC) { console.error('No RPC endpoint found for getParsedTransaction'); }
  console.log('connecting to', scrubKey_merged_7(url));

  const ws = new WebSocket_merged_7(url);
  const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const foundMints = new Map();
  let notifCount = 0;

  ws.on('open', ()=>{
    console.log('WS open');
    ws.send(JSON.stringify({ jsonrpc:'2.0', id:1, method:'programSubscribe', params:[TOKEN_PROG, { encoding:'jsonParsed', commitment:'confirmed' }] }));
    console.log('subscribed to Token program; collecting for 20s...');
    setTimeout(async ()=>{
      ws.close();
      console.log('WS closed; collected', foundMints.size, 'unique candidate mints; total notifications=', notifCount);
      const toCheck = Array.from(foundMints.keys()).slice(0,10);
      if(toCheck.length===0){ process.exit(0); }
      console.log('Resolving parse-history + getParsedTransaction for first', toCheck.length, 'mints');
      for(const m of toCheck){
        try{
          if(!parseHistoryTemplate){ console.log('no parse-history URL in .env for', m); continue; }
          const urlHist = parseHistoryTemplate.replace('{address}', m);
          const r = await axios_merged_7.get(urlHist, { timeout: 15000 });
          const body = r.data;
          if(Array.isArray(body) && body.length>0){
            const first = body[0];
            console.log('\nparse-history', m, 'txs=', body.length, 'firstSig=', first.signature, 'slot=', first.slot, 'blockTime=', first.blockTime || null);
            if((first.blockTime === null || first.blockTime === undefined) && first.signature){
              try{ const req = { jsonrpc:'2.0', id:1, method:'getParsedTransaction', params:[first.signature, 'confirmed'] }; const r2 = await axios_merged_7.post(RPC, req, { headers: {'Content-Type':'application/json'}, timeout: 15000 }); const res2 = r2.data && r2.data.result; console.log('  -> getParsedTransaction', first.signature.slice(0,8), 'slot=', res2 && res2.slot, 'blockTime=', res2 && res2.blockTime); }catch(err){ console.log('  -> getParsedTransaction error', err && err.message); }
            }
          } else { console.log('\nparse-history', m, 'no txs'); }
        }catch(err){ console.log('\nparse-history', m, 'error', err && err.message); }
      }
      process.exit(0);
    }, 20000);
  });

  ws.on('message', (m)=>{
    notifCount++;
    let j;
    try{ j = JSON.parse(m.toString()); }catch(e){ return; }
    const params = j.params || {};
    const res = params.result || {};
    const val = res.value || res.account || res;
    try{ const parsed = val.data && val.data.parsed ? val.data.parsed : val.data && Array.isArray(val.data) ? (val.data[1] && val.data[1].parsed) : (val.parsed || null); if(parsed && parsed.info && parsed.info.mint){ const candidate = parsed.info.mint; if(!foundMints.has(candidate)){ foundMints.set(candidate, {firstSlot: res.context && res.context.slot || null, evidence:'parsed.info.mint'}); } return; } }catch(e){}
    try{ if(val.account && val.account.data && val.account.data.parsed && val.account.data.parsed.info && val.account.data.parsed.info.mint){ const candidate = val.account.data.parsed.info.mint; if(!foundMints.has(candidate)) foundMints.set(candidate, {firstSlot: res.context && res.context.slot || null, evidence:'account.data.parsed'}); return; } }catch(e){}
  });

  ws.on('error', (e)=>{ console.error('ws error', e && e.message); process.exit(2); });
})();

// --- end: tmp_mint_timestamps.js ---


// --- begin: tmp_helius_ws_test.js ---

const fs_merged_8 = require('fs');
const WebSocket_merged_8 = require('ws');

function readEnv_merged_8() { const raw = fs_merged_8.readFileSync('.env', 'utf8'); const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); const map = {}; for (const l of lines) { const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0, i); const v = l.slice(i + 1); map[k] = v; } return map; }

(async function main(){
  try {
    const env = readEnv_merged_8();
    const url = env.HELIUS_WEBSOCKET_URL;
    if (!url) { console.error('HELIUS_WEBSOCKET_URL not found in .env'); process.exit(1); }
    console.log('connecting to', url.replace(/(\?|&)?api-key=[^&]+/, '?api-key=***'));
    const ws = new WebSocket_merged_8(url);
    let cnt = 0;

    ws.on('open', () => {
      console.log('WS open');
      setTimeout(() => { ws.close(); console.log('WS closed, messages=', cnt); process.exit(0); }, 20000);
    });

    ws.on('message', (m) => {
      cnt++;
      const s = m.toString();
      try {
        const j = JSON.parse(s);
        const info = { msgIndex: cnt };
        if (j.type) info.type = j.type;
        if (j.method) info.method = j.method;
        if (j.params && typeof j.params === 'object') info.paramsKeys = Object.keys(j.params).slice(0,4);
        if (j.result && j.result.transaction && j.result.transaction.message) {
          info.hasParsed = Array.isArray(j.result.transaction.message.instructions) && j.result.transaction.message.instructions.length>0;
          if (info.hasParsed) { info.instructionsSample = j.result.transaction.message.instructions.slice(0,2).map(ins => { return {program: ins.program, parsed: !!ins.parsed, type: ins.parsed ? ins.parsed.type : undefined}; }); }
        }
        if (j.signature) info.signature = (typeof j.signature==='string') ? j.signature.slice(0,8) : undefined;
        console.log(JSON.stringify(info));
      } catch (e) { console.log('raw', s.slice(0,800)); }
    });

    ws.on('error', (e) => { console.error('ws error', e && e.message); process.exit(2); });
  } catch (err) { console.error('failed to start', err && err.message); process.exit(3); }
})();

// --- end: tmp_helius_ws_test.js ---


// --- begin: tmp_call_handle_ts.ts (archived as comment) ---

/*
import { startHeliusWebsocketListener, getRecentHeliusEvents } from './src/heliusWsListener';
import { handleNewMintEvent } from './src/fastTokenFetcher';

(async () => {
  try {
    console.log('Starting Helius listener for 12s...');
    const inst = await startHeliusWebsocketListener({ onOpen: () => console.log('WS open'), onMessage: () => {}, onClose: () => console.log('WS closed'), onError: (e: any) => console.warn('WS error', e && e.message) });
    await new Promise(r => setTimeout(r, 12_000));
    const evs = getRecentHeliusEvents();
    console.log('Captured events:', evs.length);
    const toCall = (evs || []).slice(0, 8);
    for (const e of toCall) {
      try {
        console.log('\nCalling handleNewMintEvent for', e.mint, 'firstSlot=', e.firstSlot || (e.raw && e.raw.params && e.raw.params.result && e.raw.params.result.context && e.raw.params.result.context.slot));
        const res = await handleNewMintEvent(e, {}, null);
        console.log('result:', res);
      } catch (err) { console.error('call err', err && (err as any).message ? (err as any).message : err); }
    }
    try { if (inst && inst.stop) await inst.stop(); } catch (e) {}
  } catch (e) { console.error('failed', e && (e as any).message ? (e as any).message : e); process.exit(1); }
})();
*/

// --- end: tmp_call_handle_ts.ts ---


// (run_quick_discovery.js and quick_discovery.ts were archived above in comments)


// --- begin: tmp/quick_discovery.ts (archived as comment) ---

/*
require("ts-node/register");
(async () => {
  try {
    const f = require("./src/fastTokenFetcher");
    const tu = require("./utils/tokenUtils");
    console.log("[test] Fetching unified candidates (limit=200)...");
    const candidates = await f.getUnifiedCandidates(200).catch(e=>{ console.error('[test] getUnifiedCandidates err', e && e.message); return []; });
    console.log('[test] candidates count=', (candidates||[]).length);
    const uniq = Array.from(new Set((candidates||[]).map(c=>c.mint))).slice(0,200);
    console.log('[test] unique candidates=', uniq.length);
    const entries = uniq.map(a=>({ tokenAddress: a, address: a, mint: a }));
    console.log('[test] Ensuring canonical on-chain ages (timeoutMs=3000, concurrency=3)...');
    await f.ensureCanonicalOnchainAges(entries, { timeoutMs: 3000, concurrency: 3 }).catch(e=>{ console.error('[test] ensureCanonicalOnchainAges err', e && e.message); });
    console.log('[test] Fetching DexScreener tokens (limit=500) to get volume info...');
    let dexArr = [];
    try { const ds = await tu.fetchDexScreenerTokens('solana', { limit: String(500) }); dexArr = Array.isArray(ds) ? ds : (ds && ds.data) ? ds.data : []; } catch(e) { console.error('[test] dex fetch err', e && e.message); }
    const dexMap: Record<string, any> = {};
    for (const d of (dexArr||[])) { try { const addr = tu.normalizeMintCandidate(d.address || d.tokenAddress || d.pairAddress || (d.token && d.token.address) || d.mint || null); if (addr) dexMap[addr] = d; } catch (e) {} }
    const matches: any[] = [];
    for (const e of entries) { try { const addr = e.tokenAddress || e.address || e.mint; const meta = dexMap[addr] || {}; const volume = Number(meta.volumeUsd ?? meta.volume ?? meta.h24 ?? meta.volume24 ?? 0) || 0; const ageSec = (typeof e._canonicalAgeSeconds === 'number') ? e._canonicalAgeSeconds : (e.firstBlockTime ? (Math.floor(Date.now()/1000) - Math.floor(Number(e.firstBlockTime))) : null); const ageMin = (ageSec === null || ageSec === undefined) ? null : (ageSec/60); if (ageMin !== null && ageMin >= 0 && ageMin <= 40 && volume >= 50) { matches.push({ address: addr, ageMin: Math.round(ageMin*100)/100, volume, firstBlockTime: e.firstBlockTime || null, sources: e.__sources || null }); } } catch (e) {} }
    matches.sort((a,b)=> (a.ageMin || 0) - (b.ageMin || 0));
    console.log('[test] Total matches (0-40min, vol>=50$):', matches.length);
    for (const r of matches.slice(0,5)) console.log(JSON.stringify(r));
  } catch (err) { console.error('[test] script error', err && err.stack); process.exit(1); }
})();
*/

// --- end: tmp/quick_discovery.ts ---


// --- archive complete ---

