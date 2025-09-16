// Side-effect module: disable network calls and noisy logging across the app.
// Intended to be imported as early as possible in entrypoints to prevent
// network activity and console emissions during listener-only runs.

// Silence console methods but keep process.stdout.write intact for canonical stream
['log','info','warn','error','debug'].forEach((k:any)=>{ try{ (console as any)[k]=()=>{} }catch(e){} });

// Stub dotenv.config to avoid loading .env
try{
  const maybeDotenv = require.resolve('dotenv');
  try{ require.cache[maybeDotenv] = { exports: { config: ()=>({}) } } }catch(e){}
}catch(e){}

// Lightweight stubs for common network libs used in code
const noopAsync = async (..._a:any[])=> null;
const noopSync = (..._a:any[])=> null;

// Patch axios if present
try{
  const axiosPath = require.resolve('axios');
  const axiosStub = {
    get: noopAsync,
    post: noopAsync,
    create: ()=>axiosStub,
  };
  require.cache[axiosPath] = { exports: axiosStub };
}catch(e){}

// Patch ws (WebSocket) constructor to be a no-op stub
try{
  const wsPath = require.resolve('ws');
  class WSStub {
    constructor(){ }
    on(){ }
    send(){ }
    close(){ }
  }
  require.cache[wsPath] = { exports: WSStub };
}catch(e){}

// Patch global fetch if present
try{
  if(!(globalThis as any).fetch) (globalThis as any).fetch = noopAsync;
}catch(e){}

// Neutralize direct environment-driven network endpoints by clearing sensitive vars
try{
  ['HELIUS_API_KEY','HELIUS_API_KEYS','HELIUS_RPC_URL','HELIUS_FAST_RPC_URL','HELIUS_WEBSOCKET_URL','MAINNET_RPC','RPC_URL','WS_ENDPOINT','SOLSCAN_API_URL','JUPITER_QUOTE_API','JUPITER_SWAP_API'].forEach(k=>{ try{ process.env[k]=''; }catch(e){} });
}catch(e){}

// Provide minimal stubs for functions exported by `src/config.ts` when other modules import it
// We can't easily override TypeScript exports at runtime, but clearing envs and stubbing libs
// prevents most network activity. If specific functions are required, they can be patched in their files.

// End of file (side-effect only)
