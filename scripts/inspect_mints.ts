import 'dotenv/config';
import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

async function heliusRpcCall(url: string, method: string, params: any[] = []) {
  const payload = { jsonrpc: '2.0', id: 1, method, params };
  try {
    const res = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
    return res.data?.result ?? res.data;
  } catch (e: any) {
    return { __error: e && (e.message || e.toString()), status: e.response?.status };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('Usage: ts-node scripts/inspect_mints.ts <mint1> [mint2 ...]'); process.exit(1); }

  const heliusFast = process.env.HELIUS_FAST_RPC_URL || process.env.HELIUS_RPC_URL || process.env.MAINNET_RPC;
  const heliusRpc = process.env.HELIUS_RPC_URL || process.env.HELIUS_FAST_RPC_URL || process.env.MAINNET_RPC;
  const parseHistoryTemplate = process.env.HELIUS_PARSE_HISTORY_URL || null;

  console.log('Using endpoints:');
  console.log('HELIUS_FAST_RPC_URL:', heliusFast ? '[redacted]' : 'not set');
  console.log('HELIUS_RPC_URL:', heliusRpc ? '[redacted]' : 'not set');
  console.log('HELIUS_PARSE_HISTORY_URL:', parseHistoryTemplate ? '[redacted]' : 'not set');

  for (const mint of args) {
    console.log('\n=== Inspect:', mint, '===');
    const rpcUrl = heliusFast || heliusRpc;
    if (!rpcUrl) { console.log('No RPC configured in env (HELIUS_FAST_RPC_URL / HELIUS_RPC_URL / MAINNET_RPC)'); continue; }

    console.log('\n1) getSignaturesForAddress (paged, collecting up to 2000)');
    // page signatures backwards to try to find the earliest signature for this address
    async function collectSignatures(address: string, maxCollect = 2000) {
      const out: any[] = [];
      let before: string | null = null;
      const limit = 1000;
      for (let i = 0; i < 5 && out.length < maxCollect; i++) {
        const params: any[] = [address, { limit }];
        if (before) params[1].before = before;
        const res: any = await heliusRpcCall(rpcUrl, 'getSignaturesForAddress', params);
        if (res && res.__error) { return { __error: res.__error }; }
        if (!Array.isArray(res) || res.length === 0) break;
        out.push(...res);
        if (res.length < limit) break;
        before = res[res.length - 1].signature || res[res.length - 1].txHash || null;
      }
      return out.slice(0, maxCollect);
    }

  if (!rpcUrl) { console.log('No RPC configured, skipping'); continue; }
  const sigs = await collectSignatures(mint, 2000);
    if (Array.isArray(sigs)) {
      console.log('Signatures count (collected):', sigs.length);
      const times = sigs.map((s:any)=>s.blockTime || s.block_time || s.blocktime || s.timestamp || null).filter(Boolean).map(Number);
      const min = times.length ? Math.min(...times) : null;
      const max = times.length ? Math.max(...times) : null;
      console.log('blockTime min:', min, 'max:', max);
      console.log('sample signatures (first 5):', sigs.slice(0,5).map((s:any)=>({ signature: s.signature || s.txHash, blockTime: s.blockTime||s.block_time||s.timestamp }))); 
    } else if (sigs && (sigs as any).__error) {
      console.log('Signatures error:', (sigs as any));
    } else {
      console.log('No signatures returned. Raw:', JSON.stringify(sigs).slice(0,1000));
    }

    // pick earliest signature if available
    let earliestSig: string | null = null;
    if (Array.isArray(sigs) && sigs.length) {
      const sorted = sigs.slice().filter((s:any)=>s && (s.signature || s.txHash)).sort((a:any,b:any)=>{
        const at = Number(a.blockTime||a.block_time||a.blocktime||0)||0;
        const bt = Number(b.blockTime||b.block_time||b.blocktime||0)||0;
        return at - bt;
      });
      earliestSig = sorted[0]?.signature || sorted[0]?.txHash || null;
    }

    if (earliestSig) {
      console.log('\n2) getTransaction for earliest signature ->', earliestSig);
      // include maxSupportedTransactionVersion to avoid Helius client error for some transactions
      const parsed = await heliusRpcCall(rpcUrl, 'getTransaction', [earliestSig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      if (parsed && parsed.__error) console.log('getTransaction error:', parsed);
      else {
        const pbt = parsed?.blockTime ?? parsed?.result?.blockTime ?? parsed?.result?.block_time ?? parsed?.result?.blocktime ?? null;
        console.log('getTransaction blockTime:', pbt);
        console.log('getTransaction raw (truncated):', JSON.stringify(parsed).slice(0,1200));
      }
    } else {
      console.log('\nNo earliest signature found to call getTransaction');
    }

    // 3) parse-history endpoint if available
    if (parseHistoryTemplate) {
      try {
        const url = parseHistoryTemplate.replace('{address}', encodeURIComponent(mint));
        console.log('\n3) Helius parse-history ->', '[redacted]');
        const res = await axios.get(url, { timeout: 10000 });
        const arr = res.data ?? [];
        if (Array.isArray(arr) && arr.length) {
          const times = arr.map((x:any)=>x.blockTime||x.block_time||x.timestamp||x.time||null).filter(Boolean).map(Number);
          console.log('parse-history entries:', arr.length, 'minTime:', times.length ? Math.min(...times) : null, 'maxTime:', times.length ? Math.max(...times) : null);
          console.log('parse-history sample (first 3):', JSON.stringify(arr.slice(0,3)).slice(0,1200));
        } else {
          console.log('parse-history returned non-array or empty. Raw:', JSON.stringify(res.data).slice(0,1000));
        }
      } catch (e:any) {
        console.log('parse-history error:', e && (e.message || e.toString()));
      }
    }

    // 4) try getAccountInfo for metadata PDA and tokenSupply
    try {
      // compute metadata PDA for the mint (Metaplex metadata program)
      console.log('\n4) compute metadata PDA and getAccountInfo (mint + metadataPDA)');
      let metadataPda: string | null = null;
      try {
        const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
        const mintPk = new PublicKey(mint);
        const seeds = [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mintPk.toBuffer()];
        const pda = await PublicKey.findProgramAddress(seeds, METADATA_PROGRAM);
        metadataPda = pda[0].toBase58();
      } catch (e) { metadataPda = null; }
      console.log('metadataPda:', metadataPda);
      console.log('getAccountInfo (mint):');
      const ai = await heliusRpcCall(rpcUrl, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
      if (ai && ai.__error) console.log('getAccountInfo error:', ai);
      else console.log('getAccountInfo summary (truncated):', JSON.stringify(ai).slice(0,800));
      if (metadataPda) {
        const mid = await heliusRpcCall(rpcUrl, 'getAccountInfo', [metadataPda, { encoding: 'jsonParsed' }]);
        if (mid && mid.__error) console.log('metadata getAccountInfo error:', mid);
        else console.log('metadata PDA getAccountInfo (truncated):', JSON.stringify(mid).slice(0,800));
      }
    } catch (e:any) { console.log('getAccountInfo error:', e && e.message); }
  }
}

main().catch(e=>{ console.error('Fatal:', e && e.message); process.exit(1); });
