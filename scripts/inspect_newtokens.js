#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const IN = path.resolve(__dirname, 'last_run_results.json');
const OUT = path.resolve(__dirname, 'last_run_newtokens_txdetails.json');
const HELIUS_RPC = process.env.HELIUS_RPC || 'https://rpc.helius.xyz';
const HELIUS_KEY = process.env.HELIUS_KEY || process.env.HELIUS_API_KEY || process.env.HELIUS;

if (!fs.existsSync(IN)) { console.error('Input file not found:', IN); process.exit(2); }
const raw = fs.readFileSync(IN,'utf8');
const data = JSON.parse(raw);

const common = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'So11111111111111111111111111111111111111112',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
]);
function isCommon(m){ return !m || common.has(m); }

async function heliusRpc(method, params){
  const body = { jsonrpc: '2.0', id:1, method, params };
  const headers = { 'Content-Type': 'application/json' };
  if (HELIUS_KEY) headers['x-api-key'] = HELIUS_KEY;
  const url = HELIUS_RPC;
  try{
    const r = await axios.post(url, body, { headers, timeout: 20000 });
    return r.data;
  }catch(err){
    return { error: (err.response && err.response.statusText) || err.message, status: err.response && err.response.status, body: err.response && err.response.data };
  }
}

async function inspectSignature(signature, it){
  const res = await heliusRpc('getTransaction', [signature, { encoding: 'jsonParsed' }]);
  const out = { signature, program: it.program || null, blockTime: it.blockTime || null, timeISO: it.blockTime? new Date(it.blockTime*1000).toISOString():null, mints: it.mints||[], newMints: (it.mints||[]).filter(m=>!isCommon(m)), summaryLog: it.summaryLog||[], error: null };
  if (res.error || res.result === undefined) {
    out.error = res.error || res.body || res;
    return out;
  }
  const tx = res.result;
  out.tx = { meta: tx.meta || null, transaction: tx.transaction || null };

  // scan instructions for InitializeMint / MintTo / InitializeAccount / Swap-like
  const logs = (tx.meta && tx.meta.logMessages) ? tx.meta.logMessages.join(' | ') : '';
  const instructions = [];
  try{
    const message = tx.transaction && tx.transaction.message;
    const instrs = (message && message.instructions) || [];
    for(const ins of instrs){
      const progId = ins.programId || ins.programIdIndex || (ins.program && ins.program);
      const parsed = ins.parsed || null;
      const type = parsed && parsed.type ? parsed.type : (ins.type || null);
      instructions.push({ progId, type, raw: ins });
    }
  }catch(e){ /* ignore */ }
  out.parsedInstructions = instructions;

  out.foundInitializeMint = instructions.some(i=> (i.type && i.type.toLowerCase().includes('initializemint')) || (i.type && i.type.toLowerCase().includes('initializeMint'.toLowerCase())) );
  out.foundMintTo = instructions.some(i=> (i.type && i.type.toLowerCase().includes('mintto')) );
  out.foundInitAccount = instructions.some(i=> (i.type && i.type.toLowerCase().includes('initializeaccount')) );
  // naive swap detection: instruction types containing 'swap' or program ids known for swaps
  out.foundSwapInstruction = instructions.some(i=> (i.type && i.type.toLowerCase().includes('swap')) || (i.progId && String(i.progId).toLowerCase().includes('jup')) || (i.progId && String(i.progId).toLowerCase().includes('amm')) );
  out.logsSnippet = logs.slice(0,1000);
  return out;
}

(async function main(){
  const results = [];
  // flatten candidates from data.results
  const candidates = [];
  for(const prog of data.results||[]){
    for(const it of prog.found||[]){
      candidates.push(Object.assign({ program: prog.program }, it));
    }
  }
  // optional: prefer newest first
  candidates.sort((a,b)=> (b.blockTime||0)-(a.blockTime||0));

  const MAX = process.env.MAX || 50;
  console.error(`Found ${candidates.length} candidates, verifying up to ${MAX} (sequential).`);

  for(let i=0;i<Math.min(candidates.length, MAX); i++){
    const it = candidates[i];
    const sig = it.signature;
    try{
      const info = await inspectSignature(sig, it);
      results.push(info);
      // print concise line to terminal
      const time = info.timeISO || '-';
      const newM = (info.newMints||[]).slice(0,5).join(',') || '-';
      const init = info.foundInitializeMint || info.foundInitAccount ? 'init' : '-';
      const mintto = info.foundMintTo ? 'mintTo' : '-';
      const swap = info.foundSwapInstruction ? 'swap' : '-';
      console.log(`${time} ${sig} program:${info.program || '-'} newM:${newM} flags:${init}/${mintto}/${swap} logs:${(info.summaryLog||[]).slice(0,2).join(' | ')}`);
    }catch(e){
      console.error('Error inspecting', sig, e && e.message);
      results.push({ signature: sig, error: e && e.message });
    }
    // polite delay
    await new Promise(r=>setTimeout(r, 250));
  }

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), verifiedCount: results.length, results }, null, 2));
  console.error('\nWrote verification details to', OUT);
})();
