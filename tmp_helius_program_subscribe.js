const fs = require('fs');
const WebSocket = require('ws');

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

(async function main(){
  try {
    const env = readEnv();
    const url = env.HELIUS_WEBSOCKET_URL;
    if (!url) {
      console.error('HELIUS_WEBSOCKET_URL not found in .env');
      process.exit(1);
    }
    const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    console.log('connecting to', url.replace(/(\?|&)?api-key=[^&]+/, '?api-key=***'));
    const ws = new WebSocket(url);
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
