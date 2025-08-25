import { getBlockTimeForSlotCached } from '../src/fastTokenFetcher';
import axios from 'axios';
import { connection, MAINNET_RPC } from '../src/config';

async function run() {
  const slot = 362291284;
  console.log('Testing getBlockTimeForSlotCached for slot', slot);
  console.log('ENV:', { MAINNET_RPC: process.env.MAINNET_RPC, HELIUS_RPC_URL: process.env.HELIUS_RPC_URL });
  const start = Date.now();
  // helper to race promise against timeout
  const withTimeout = async <T>(p: Promise<T>, ms: number, label: string) => {
    let timed = false;
    const timer = new Promise<T>((_, rej) => setTimeout(() => { timed = true; rej(new Error('timeout')); }, ms));
    try {
      const r = await Promise.race([p, timer]);
      return { ok: true as const, result: r, timed };
    } catch (e: any) {
      return { ok: false as const, error: e, timed };
    }
  };

  console.log('Testing path: getBlockTimeForSlotCached');
  const res1 = await withTimeout(getBlockTimeForSlotCached(slot), 7000, 'cached');
  console.log('getBlockTimeForSlotCached ->', res1.ok ? { blockTime: res1.result } : { error: String(res1.error) });

  // try direct connection.getBlockTime
  try {
    const conn = connection;
    console.log('Testing path: connection.getBlockTime (exists?)', !!conn && typeof conn.getBlockTime === 'function');
    if (conn && typeof conn.getBlockTime === 'function') {
      const res2 = await withTimeout(conn.getBlockTime(Number(slot)), 7000, 'conn');
      console.log('connection.getBlockTime ->', res2.ok ? { blockTime: res2.result } : { error: String(res2.error) });
    }
  } catch (e) {
    console.log('connection.getBlockTime error', e && e.message ? e.message : e);
  }

  // try direct HTTP RPC via axios
  try {
  console.log('Testing path: HTTP RPC via axios to', process.env.MAINNET_RPC || MAINNET_RPC);
  const rpcUrl = process.env.MAINNET_RPC || MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
    const payload = { jsonrpc: '2.0', id: 1, method: 'getBlockTime', params: [slot] };
    const res3 = await withTimeout(axios.post(rpcUrl, payload, { timeout: 5000 }).then(r => r.data), 7000, 'http');
    console.log('HTTP RPC ->', res3.ok ? { result: res3.result } : { error: String(res3.error) });
  } catch (e) {
    console.log('HTTP RPC error', e && (e as any).message ? (e as any).message : e);
  }
  const elapsed = Date.now() - start;
  console.log('Total elapsedMs:', elapsed);
}

run().then(() => process.exit(0)).catch(() => process.exit(1));
