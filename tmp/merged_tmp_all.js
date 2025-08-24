// Merged temporary scripts - generated automatically
// Source files merged:
// - tmp_dump_params.js
// - tmp_helius_program_subscribe.js
// - tmp_helius_mint_inspect.js
// - tmp_call_handle.js
// - tmp_get_parsed_tx_timestamps.js
// - tmp_mint_timestamps.js
// - tmp_helius_ws_test.js

// --- begin: tmp_dump_params.js ---

const fs_merged_1 = require('fs');
const WebSocket_merged_1 = require('ws');

function readEnv_merged_1() {
  const raw = fs_merged_1.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) {
    const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0,i); const v = l.slice(i+1); map[k]=v;
  }
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
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i === -1) continue;
    const k = l.slice(0, i);
    const v = l.slice(i + 1);
    map[k] = v;
  }
  return map;
}

(async function main(){
  try {
    const env = readEnv_merged_2();
    const url = env.HELIUS_WEBSOCKET_URL;
    if (!url) {
      console.error('HELIUS_WEBSOCKET_URL not found in .env');
      process.exit(1);
    }
    const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    console.log('connecting to', url.replace(/(\?|&)?api-key=[^&]+/, '?api-key=***'));
    const ws = new WebSocket_merged_2(url);
    let cnt = 0;
    let notifications = 0;

    ws.on('open', () => {
      console.log('WS open');
      // send programSubscribe JSON-RPC
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
        // subscription acknowledgement: {jsonrpc, result: subId, id}
        if (j.result && typeof j.result === 'number') {
          console.log('subscribed id=', j.result);
          return;
        }
        // notifications: {jsonrpc, method: 'programNotification', params: {subscription: id, result: {...}}}
        if (j.method && j.method.includes('program')) {
          notifications++;
          const params = j.params || {};
          const res = params.result || {};
          const acc = res?.account || res?.value || {};
          const parsed = res?.value?.data || acc?.data || undefined;
          // print a compact summary
          const summary = {msgIndex: cnt, method: j.method, subscription: params.subscription || null};
          if (res?.context) summary.slot = res.context.slot;
          if (res?.value && res.value?.account) summary.accountKey = (res.value.account?.pubkey || '').slice(0,8);
          if (Array.isArray(res?.value?.data)) summary.dataLen = res.value.data.length;
          console.log(JSON.stringify(summary));
          return;
        }
        // otherwise print small shape
        const info = { msgIndex: cnt, keys: Object.keys(j).slice(0,6) };
        console.log(JSON.stringify(info));
      } catch (e) {
        console.log('raw', s.slice(0,400));
      }
    });

    ws.on('error', (e) => {
      console.error('ws error', e && e.message);
      process.exit(2);
    });
  } catch (err) {
    console.error('failed to start', err && err.message);
    process.exit(3);
  }
})();

// --- end: tmp_helius_program_subscribe.js ---


// --- begin: tmp_helius_mint_inspect.js ---

const fs_merged_3 = require('fs');
const WebSocket_merged_3 = require('ws');
const axios_merged_3 = require('axios').default || require('axios');

function readEnv_merged_3() {
  const raw = fs_merged_3.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i === -1) continue;
    const k = l.slice(0, i);
    const v = l.slice(i + 1);
    map[k] = v;
  }
  return map;
}

function scrubKey_merged_3(url){
  return url ? url.replace(/(\?|&)?api-key=[^&]+/,'?api-key=***') : url;
}

(async function main(){
  try{
    const env = readEnv_merged_3();
    const url = env.HELIUS_WEBSOCKET_URL;
    const parseHistoryTemplate = env.HELIUS_PARSE_HISTORY_URL || env.HELIUS_PARSE_HISTORY;
    if(!url) { console.error('HELIUS_WEBSOCKET_URL not set'); process.exit(1); }
    console.log('connecting to', scrubKey_merged_3(url));
    const ws = new WebSocket_merged_3(url);
    const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const foundMints = new Map(); // mint -> {slot, evidence, sample}
    let notifCount=0;

    ws.on('open', ()=>{
      console.log('WS open');
      const msg = { jsonrpc: '2.0', id: 1, method: 'programSubscribe', params: [TOKEN_PROG, { encoding: 'jsonParsed', commitment: 'confirmed' }] };
      ws.send(JSON.stringify(msg));
      console.log('subscribed programSubscribe TOKEN program; collecting notifications for 20s...');
      setTimeout(()=>{
        ws.close();
        console.log('WS closed; collected', foundMints.size, 'unique candidate mints; total notifications=', notifCount);
        // print summary
        let i=0;
        for(const [mint, v] of foundMints){
          if(i>=50) break;
          console.log('MINT', i+1, mint, JSON.stringify(v).slice(0,600));
          i++;
        }
        // optionally fetch parse-history for first 10
        (async ()=>{
          const toCheck = Array.from(foundMints.keys()).slice(0,10);
          if(!parseHistoryTemplate || toCheck.length===0){
            process.exit(0);
          }
          console.log('\nFetching parse-history for first', toCheck.length, 'mints to get timestamps (this may be slow)...');
          for(const m of toCheck){
            try{
              const urlHist = parseHistoryTemplate.replace('{address}', m);
                  const r = await axios_merged_3.get(urlHist, { timeout: 10000 });
                  const body = r.data;
              // body is array of txs; pick earliest or first
              if(Array.isArray(body) && body.length>0){
                const first = body[0];
                console.log('parse-history', m, 'txs=', body.length, 'firstSig=', first.signature, 'slot=', first.slot, 'ts=', first.blockTime || null);
              } else {
                console.log('parse-history', m, 'no txs');
              }
            }catch(err){
              console.log('parse-history', m, 'error', err && err.message);
            }
          }
          process.exit(0);
        })();
      }, 20000);
    });

    ws.on('message', (m)=>{
      notifCount++;
      const s = m.toString();
      let j;
      try{ j = JSON.parse(s); }catch(e){ return; }
      // we expect notifications like {jsonrpc,..., method:'programNotification', params:{subscription, result:{context, value}}}
      const params = j.params || {};
      const res = params.result || {};
      const val = res.value || res.account || res; // try multiple shapes
      // Try to extract mint
      let candidate = null;
      let evidence = null;
      // path 1: parsed account data (token account -> parsed.info.mint)
      try{
        const parsed = val.data && val.data.parsed ? val.data.parsed : val.data && Array.isArray(val.data) ? (val.data[1] && val.data[1].parsed) : (val.parsed || null);
        if(parsed && parsed.info && parsed.info.mint){
          candidate = parsed.info.mint;
          evidence = {type:'tokenAccount', hostPubkey: val.pubkey || res.value && res.value.account && res.value.account.pubkey || null, parsedInfo: parsed.info};
        } else if(parsed && parsed.type === 'mint'){
          // the account itself is a mint
          candidate = val.pubkey || res.value && res.value.account && res.value.account.pubkey || null;
          evidence = {type:'mintAccount', parsedInfo: parsed.info};
        }
      }catch(e){ /* ignore */ }

      // path 2: sometimes Helius returns value.account.data.parsed.info
      if(!candidate){
        try{
          if(val.account && val.account.data && val.account.data.parsed && val.account.data.parsed.info && val.account.data.parsed.info.mint){
            candidate = val.account.data.parsed.info.mint;
            evidence = {type:'tokenAccount2', hostPubkey: val.pubkey || val.account && val.account.pubkey, parsedInfo: val.account.data.parsed.info};
          }
        }catch(e){}
      }

      // path 3: if the value is a full parsed transaction (rare here), inspect instructions
      if(!candidate){
        try{
          const tx = j.result && j.result.transaction ? j.result.transaction : null;
          const msg = tx && tx.message ? tx.message : null;
          if(msg && msg.instructions && Array.isArray(msg.instructions)){
            for(const ins of msg.instructions){
              if(ins.parsed && ins.parsed.type){
                const t = ins.parsed.type.toLowerCase();
                if(t.includes('initialize') || t.includes('mint') || t.includes('create')){
                  // check parsed info for mint
                  if(ins.parsed.info && ins.parsed.info.mint) {
                    candidate = ins.parsed.info.mint;
                    evidence = {type:'parsedInstr', instrType:ins.parsed.type, parsedInfo:ins.parsed.info};
                    break;
                  }
                }
              }
            }
          }
        }catch(e){}
      }

      if(candidate){
        if(!foundMints.has(candidate)){
          foundMints.set(candidate, {firstSlot: res.context && res.context.slot || null, evidence, sample: JSON.stringify(val).slice(0,1000)});
        }
      }

    });

    ws.on('error', (e)=>{
      console.error('ws error', e && e.message);
      process.exit(2);
    });

  }catch(err){
    console.error('failed', err && err.message);
    process.exit(3);
  }
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

function readEnv_merged_6(){
  const raw = fs_merged_6.readFileSync('.env','utf8');
  const map = {};
  raw.split(/\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#')).forEach(l=>{const i=l.indexOf('='); if(i===-1) return; const k=l.slice(0,i); map[k]=l.slice(i+1);});
  return map;
}

(async function(){
  const env = readEnv_merged_6();
  const url = env.HELIUS_WEBSOCKET_URL;
  const HELIUS_RPC = env.HELIUS_RPC_URL || env.HELIUS_FAST_RPC_URL || env.MAINNET_RPC;
  if(!url) { console.error('no HELIUS_WEBSOCKET_URL'); process.exit(1); }
  if(!HELIUS_RPC) { console.error('no RPC endpoint for getParsedTransaction'); process.exit(1); }
  const ws = new WebSocket_merged_6(url);
  const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  let sigs = new Set();
  ws.on('open', ()=>{ console.log('open'); ws.send(JSON.stringify({ jsonrpc:'2.0', id:1, method:'programSubscribe', params:[TOKEN_PROG, { encoding:'jsonParsed', commitment:'confirmed' }] })); setTimeout(async ()=>{ ws.close(); console.log('collected signatures', sigs.size); // query first 10
    const list = Array.from(sigs).slice(0,10);
    for(const s of list){
      try{
        const body = { jsonrpc:'2.0', id:1, method:'getParsedTransaction', params:[s, 'confirmed'] };
        const r = await axios_merged_6.post(HELIUS_RPC, body, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
        const data = r.data;
        const slot = data && data.result && data.result.slot;
        const ts = data && data.result && data.result.blockTime;
        console.log('sig', s.slice(0,8), 'slot=', slot, 'ts=', ts);
      }catch(err){ console.log('sig', s.slice(0,8), 'error', err && err.message); }
    }
    process.exit(0);
  }, 20000); });

  ws.on('message', m=>{
    try{
      const j = JSON.parse(m.toString());
      const params = j.params || {};
      const res = params.result || {};
      // Helius notifications can contain signature in multiple places
      // - res.value.signature
      // - res.signature
      // - res.value.transaction.signatures[0]
      // - res.transaction.signatures[0]
      let sig = null;
      if(res.value && res.value.signature) sig = res.value.signature;
      if(!sig && res.signature) sig = res.signature;
      if(!sig && res.value && res.value.transaction && Array.isArray(res.value.transaction.signatures) && res.value.transaction.signatures[0]) sig = res.value.transaction.signatures[0];
      if(!sig && res.transaction && Array.isArray(res.transaction.signatures) && res.transaction.signatures[0]) sig = res.transaction.signatures[0];
      if(sig) sigs.add(sig);
    }catch(e){ }
  });
  ws.on('error', e=>{ console.error('ws error', e && e.message); process.exit(2); });
})();

// --- end: tmp_get_parsed_tx_timestamps.js ---


// --- begin: tmp_mint_timestamps.js ---

const fs_merged_7 = require('fs');
const WebSocket_merged_7 = require('ws');
const axios_merged_7 = require('axios').default || require('axios');

function readEnv_merged_7() {
  const raw = fs_merged_7.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i === -1) continue;
    const k = l.slice(0, i);
    const v = l.slice(i + 1);
    map[k] = v;
  }
  return map;
}

function scrubKey_merged_7(url){ return url ? url.replace(/(\?|&)?api-key=[^&]+/,'?api-key=***') : url }

(async function main(){
  const env = readEnv_merged_7();
  const url = env.HELIUS_WEBSOCKET_URL;
  const parseHistoryTemplate = env.HELIUS_PARSE_HISTORY_URL || env.HELIUS_PARSE_HISTORY;
  // prefer a standard Solana RPC for getParsedTransaction (MAINNET_RPC), fallback to Helius RPC if needed
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
              try{
                const req = { jsonrpc:'2.0', id:1, method:'getParsedTransaction', params:[first.signature, 'confirmed'] };
        const r2 = await axios_merged_7.post(RPC, req, { headers: {'Content-Type':'application/json'}, timeout: 15000 });
        const res2 = r2.data && r2.data.result;
        console.log('  -> getParsedTransaction', first.signature.slice(0,8), 'slot=', res2 && res2.slot, 'blockTime=', res2 && res2.blockTime);
              }catch(err){ console.log('  -> getParsedTransaction error', err && err.message); }
            }
          } else {
            console.log('\nparse-history', m, 'no txs');
          }
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
    // try parsed token account
    try{
      const parsed = val.data && val.data.parsed ? val.data.parsed : val.data && Array.isArray(val.data) ? (val.data[1] && val.data[1].parsed) : (val.parsed || null);
      if(parsed && parsed.info && parsed.info.mint){
        const candidate = parsed.info.mint;
        if(!foundMints.has(candidate)){
          foundMints.set(candidate, {firstSlot: res.context && res.context.slot || null, evidence:'parsed.info.mint'});
        }
        return;
      }
    }catch(e){}
    // fallback account.data.parsed.info
    try{
      if(val.account && val.account.data && val.account.data.parsed && val.account.data.parsed.info && val.account.data.parsed.info.mint){
        const candidate = val.account.data.parsed.info.mint;
        if(!foundMints.has(candidate)) foundMints.set(candidate, {firstSlot: res.context && res.context.slot || null, evidence:'account.data.parsed'});
        return;
      }
    }catch(e){}

  });

  ws.on('error', (e)=>{ console.error('ws error', e && e.message); process.exit(2); });
})();

// --- end: tmp_mint_timestamps.js ---


// --- begin: tmp_helius_ws_test.js ---

const fs_merged_8 = require('fs');
const WebSocket_merged_8 = require('ws');

function readEnv_merged_8() {
  const raw = fs_merged_8.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i === -1) continue;
    const k = l.slice(0, i);
    const v = l.slice(i + 1);
    map[k] = v;
  }
  return map;
}

(async function main(){
  try {
    const env = readEnv_merged_8();
    const url = env.HELIUS_WEBSOCKET_URL;
    if (!url) {
      console.error('HELIUS_WEBSOCKET_URL not found in .env');
      process.exit(1);
    }
    console.log('connecting to', url.replace(/(\?|&)?api-key=[^&]+/, '?api-key=***'));
    const ws = new WebSocket_merged_8(url);
    let cnt = 0;

    ws.on('open', () => {
      console.log('WS open');
      setTimeout(() => {
        ws.close();
        console.log('WS closed, messages=', cnt);
        process.exit(0);
      }, 20000);
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
          if (info.hasParsed) {
            info.instructionsSample = j.result.transaction.message.instructions.slice(0,2).map(ins => {
              return {program: ins.program, parsed: !!ins.parsed, type: ins.parsed ? ins.parsed.type : undefined};
            });
          }
        }
        // For Helius notifications, there may be different shapes; include top-level keys
        if (j.signature) info.signature = (typeof j.signature==='string') ? j.signature.slice(0,8) : undefined;
        console.log(JSON.stringify(info));
      } catch (e) {
        // print raw prefix to avoid huge output
        console.log('raw', s.slice(0,800));
      }
    });

    ws.on('error', (e) => {
      console.error('ws error', e && e.message);
      process.exit(2);
    });
  } catch (err) {
    console.error('failed to start', err && err.message);
    process.exit(3);
  }
})();

// --- end: tmp_helius_ws_test.js ---
