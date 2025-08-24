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
    console.log('connecting to', url.replace(/(\?|&)?api-key=[^&]+/, '?api-key=***'));
    const ws = new WebSocket(url);
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
