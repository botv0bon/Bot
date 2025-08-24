const fs = require('fs');
const WebSocket = require('ws');
const axios = require('axios').default || require('axios');

function readEnv() {
  const raw = fs.readFileSync('.env', 'utf8');
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

function scrubKey(url){ return url ? url.replace(/(\?|&)?api-key=[^&]+/,'?api-key=***') : url }

(async function main(){
  const env = readEnv();
  const url = env.HELIUS_WEBSOCKET_URL;
  const parseHistoryTemplate = env.HELIUS_PARSE_HISTORY_URL || env.HELIUS_PARSE_HISTORY;
  // prefer a standard Solana RPC for getParsedTransaction (MAINNET_RPC), fallback to Helius RPC if needed
  const RPC = env.MAINNET_RPC || env.HELIUS_RPC_URL || env.HELIUS_FAST_RPC_URL || 'https://api.mainnet-beta.solana.com';
  if(!url) { console.error('HELIUS_WEBSOCKET_URL not set'); process.exit(1); }
  if(!RPC) { console.error('No RPC endpoint found for getParsedTransaction'); }
  console.log('connecting to', scrubKey(url));

  const ws = new WebSocket(url);
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
          const r = await axios.get(urlHist, { timeout: 15000 });
          const body = r.data;
          if(Array.isArray(body) && body.length>0){
            const first = body[0];
            console.log('\nparse-history', m, 'txs=', body.length, 'firstSig=', first.signature, 'slot=', first.slot, 'blockTime=', first.blockTime || null);
      if((first.blockTime === null || first.blockTime === undefined) && first.signature){
              try{
                const req = { jsonrpc:'2.0', id:1, method:'getParsedTransaction', params:[first.signature, 'confirmed'] };
        const r2 = await axios.post(RPC, req, { headers: {'Content-Type':'application/json'}, timeout: 15000 });
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
