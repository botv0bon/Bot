const fs = require('fs');
const WebSocket = require('ws');
const axios = require('axios').default || require('axios');

function readEnv(){
  const raw = fs.readFileSync('.env','utf8');
  const map = {};
  raw.split(/\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#')).forEach(l=>{const i=l.indexOf('='); if(i===-1) return; const k=l.slice(0,i); map[k]=l.slice(i+1);});
  return map;
}

(async function(){
  const env = readEnv();
  const url = env.HELIUS_WEBSOCKET_URL;
  const HELIUS_RPC = env.HELIUS_RPC_URL || env.HELIUS_FAST_RPC_URL || env.MAINNET_RPC;
  if(!url) { console.error('no HELIUS_WEBSOCKET_URL'); process.exit(1); }
  if(!HELIUS_RPC) { console.error('no RPC endpoint for getParsedTransaction'); process.exit(1); }
  const ws = new WebSocket(url);
  const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  let sigs = new Set();
  ws.on('open', ()=>{ console.log('open'); ws.send(JSON.stringify({ jsonrpc:'2.0', id:1, method:'programSubscribe', params:[TOKEN_PROG, { encoding:'jsonParsed', commitment:'confirmed' }] })); setTimeout(async ()=>{ ws.close(); console.log('collected signatures', sigs.size); // query first 10
    const list = Array.from(sigs).slice(0,10);
    for(const s of list){
      try{
        const body = { jsonrpc:'2.0', id:1, method:'getParsedTransaction', params:[s, 'confirmed'] };
        const r = await axios.post(HELIUS_RPC, body, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
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
