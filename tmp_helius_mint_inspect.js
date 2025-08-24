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

function scrubKey(url){
  return url ? url.replace(/(\?|&)?api-key=[^&]+/,'?api-key=***') : url;
}

(async function main(){
  try{
    const env = readEnv();
    const url = env.HELIUS_WEBSOCKET_URL;
    const parseHistoryTemplate = env.HELIUS_PARSE_HISTORY_URL || env.HELIUS_PARSE_HISTORY;
    if(!url) { console.error('HELIUS_WEBSOCKET_URL not set'); process.exit(1); }
    console.log('connecting to', scrubKey(url));
    const ws = new WebSocket(url);
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
                  const r = await axios.get(urlHist, { timeout: 10000 });
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
