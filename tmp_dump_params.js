const fs = require('fs');
const WebSocket = require('ws');

function readEnv() {
  const raw = fs.readFileSync('.env', 'utf8');
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const map = {};
  for (const l of lines) {
    const i = l.indexOf('='); if (i === -1) continue; const k = l.slice(0,i); const v = l.slice(i+1); map[k]=v;
  }
  return map;
}

(async function(){
  const env = readEnv();
  const url = env.HELIUS_WEBSOCKET_URL;
  if(!url){ console.error('HELIUS_WEBSOCKET_URL missing'); process.exit(1); }
  const ws = new WebSocket(url);
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
