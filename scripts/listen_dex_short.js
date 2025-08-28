#!/usr/bin/env node
const axios = require('axios');
const fs = require('fs');
// load .env so process.env values (HELIUS_API_KEY, HELIUS_WEBSOCKET_URL, etc.) are available
try {
  require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
} catch (e) {}
const WebSocket = require('ws');

const DEX_SEARCH = process.env.DEXSCREENER_API_ENDPOINT_SEARCH || 'https://api.dexscreener.com/latest/dex/search?q=solana';
const DEX_PAIR_BASE = process.env.DEXSCREENER_API_ENDPOINT_PAIR_DETAILS_TEMPLATE || 'https://api.dexscreener.com/latest/dex/pairs/solana';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const INTERVAL_MS = 3000; // poll every 3s (more responsive)
// run duration (ms) can be overridden via env LISTEN_RUN_MS (set to 60000 for 1 minute)
const RUN_MS = Number(process.env.LISTEN_RUN_MS || 30 * 1000);
const TH_MIN = Number(process.env.NEW_TOKEN_AGE_MINUTES || 30); // lookback window in minutes
const TH_MS = TH_MIN * 60 * 1000;
// max allowed difference between pairCreatedAt and earliestTx to accept token (minutes)
const MAX_PAIR_EARLIEST_DIFF_MIN = Number(process.env.PAIR_EARLIEST_MAX_DIFF_MINUTES || 5);
const MAX_PAIR_EARLIEST_DIFF_MS = MAX_PAIR_EARLIEST_DIFF_MIN * 60 * 1000;

// protocol-aware AMM program ids / names (comma-separated in env or a file)
let KNOWN_AMM_PROGS = [];
// Protocol rules loader (dynamic reload)
let PROTOCOL_RULES = null;
const PROTOCOL_RULES_PATH = require('path').join(process.cwd(), 'scripts', 'amm_protocol_rules.json');
function loadProtocolRules() {
  try {
    if (!fs.existsSync(PROTOCOL_RULES_PATH)) return null;
    const txt = fs.readFileSync(PROTOCOL_RULES_PATH, 'utf8');
    const parsed = JSON.parse(txt);
    PROTOCOL_RULES = parsed;
    // derive KNOWN_AMM_PROGS from rules (lowercased pubkeys)
    const progs = [];
    const names = [];
    const map = {};
    for (const p of (parsed.protocols || [])) {
      if (p && p.pubkey) {
        try { progs.push(String(p.pubkey).toLowerCase()); } catch (e) {}
      }
      if (p && p.name) try { names.push(String(p.name).toLowerCase()); } catch (e) {}
      if (p && p.pubkey) map[String(p.pubkey).toLowerCase()] = p;
    }
    KNOWN_AMM_PROGS = Array.from(new Set(progs));
    // expose map for quick lookup
    PROTOCOL_RULES._map = map;
    if (KNOWN_AMM_PROGS.length) console.error('Protocol rules loaded - programs:', KNOWN_AMM_PROGS.length);
    return parsed;
  } catch (e) { console.error('Failed to load protocol rules', e && e.message || e); return null; }
}
// initial load and periodic reload every 7s
loadProtocolRules();
setInterval(() => { try { loadProtocolRules(); } catch (e) {} }, Number(process.env.PROTOCOL_RULES_RELOAD_MS || 7000));
const KNOWN_AMM_NAMES = (process.env.KNOWN_AMM_NAMES || 'raydium,orca,clmm,jupiter').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

// simple per-protocol sample collector (written every reload interval)
const SAMPLES_PATH = require('path').join(process.cwd(), 'scripts', 'protocol_samples.json');
let protocolSamples = {};
function saveSamples() {
  try { fs.writeFileSync(SAMPLES_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), samples: protocolSamples }, null, 2)); } catch (e) {}
}
setInterval(() => { try { saveSamples(); } catch (e) {} }, Number(process.env.PROTOCOL_RULES_RELOAD_MS || 7000));

// Helius RPC (used for on-chain enrichment and checks)
const HELIUS_RPC = process.env.HELIUS_RPC_URL || process.env.HELIUS_FAST_RPC_URL || 'https://rpc.helius.xyz/';
const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || '';

// Buy channel mock: list of endpoints/services that would receive accepted token addresses
const BUY_CHANNEL_TARGETS = (process.env.BUY_CHANNEL_TARGETS || 'local,executor').split(',').map(s=>s.trim()).filter(Boolean);

(async function main(){
  console.error('Listening to DexScreener (short):', DEX_SEARCH);
  console.error('Pair details base:', DEX_PAIR_BASE);
  console.error(`Threshold: pairCreatedAt within last ${TH_MIN} minutes, require on-chain first-tx to be mint/init or first-swap/pool`);

  const seen = new Set();
  const endAt = Date.now() + RUN_MS;

  // Start Helius WebSocket listener (if available)
  try {
    // prefer explicit websocket URL from env; otherwise convert RPC -> ws and append api-key as query param
    const envWs = process.env.HELIUS_WEBSOCKET_URL || process.env.HELIUS_WS_URL || '';
    let heliusWsUrl = envWs || HELIUS_RPC.replace(/^http/, 'ws');
    if (!envWs && HELIUS_KEY) {
      heliusWsUrl += (heliusWsUrl.includes('?') ? '&' : '?') + 'api-key=' + HELIUS_KEY;
    }
    // Fix accidental whitespace from concatenation above
    heliusWsUrl = heliusWsUrl.replace(/\s+/g, '');
  console.error('Starting Helius WS listener at', heliusWsUrl);
  const ws = new WebSocket(heliusWsUrl, { handshakeTimeout: 5000 });

    ws.on('open', () => {
      console.error('Helius WS open, subscribing to logsSubscribe all (finalized)');
      const sub = { jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: ['all', { commitment: 'finalized' }] };
      ws.send(JSON.stringify(sub));
    });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch (e) { return; }
      const params = msg.params || msg.result || null;
      // Helius/solana logsNotification arrives under params.result.value.logs
      const payload = (msg.params && msg.params.result) || (msg.result && msg.result.value) || null;
      const value = payload && payload.value ? payload.value : payload;
      if (!value) return;
      const logs = value.logs || value.logMessages || [];
      if (!Array.isArray(logs) || logs.length === 0) return;

      // check for mint/init/swap patterns
      const joined = logs.join('\n').toLowerCase();
      if (!(joined.includes('initializemint') || joined.includes('mintto') || joined.includes('create account') || joined.includes('initialize account') || joined.includes('swap') || joined.includes('addliquidity') || joined.includes('amm'))) return;

      const signature = value.signature || (msg.params && msg.params.result && msg.params.result.signature) || (msg.result && msg.result.signature) || null;
      if (!signature) return;

      // fetch the transaction to extract token mints
      try {
        const txBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] });
        const txResp = await axios.post(HELIUS_RPC, txBody, { headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {}), timeout: 10000 });
        const tx = txResp.data && (txResp.data.result || txResp.data);
        const meta = tx && (tx.meta || tx.transaction && tx.meta) || {};
        const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
        const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
        const mints = new Set();
        for (const b of post.concat(pre)) {
          if (b && b.mint) mints.add(b.mint);
        }
        // NOTE: do NOT add all accountKeys as mint candidates — that creates false-positives
        // (e.g. So1111..., program ids, system accounts). Only rely on pre/post token balances.
        try {
          // If there are inner instructions with parsed token balances, include those mint fields
          const inner = (tx && tx.meta && tx.meta.innerInstructions) || (tx && tx.transaction && tx.meta && tx.meta.innerInstructions) || [];
          if (Array.isArray(inner) && inner.length) {
            for (const block of inner) {
              const ins = block && block.instructions || [];
              for (const insItem of ins) {
                try {
                  const pt = insItem && insItem.parsed && insItem.parsed.info && insItem.parsed.info.postTokenBalances;
                  if (Array.isArray(pt)) {
                    for (const b of pt) if (b && b.mint) mints.add(b.mint);
                  }
                } catch (e) {}
              }
            }
          }
        } catch(e){}

        for (const mint of Array.from(mints)) {
          // filter out known program/system ids and wrapped SOL sentinel
          const lower = String(mint).toLowerCase();
          const deny = new Set(['11111111111111111111111111111111','tokenkegqfezyinwajnbbgkpfxcwubvf9ss623vq5da','memosq4gqabaxkb96qnh8tysncwxmywcqxgdlgmfchr','metaqbxxuerdq28cj1rbawkyqm3ybzjb6a8bt518x1s','so11111111111111111111111111111111111111112']);
          if (deny.has(lower)) continue;
          if (seen.has(mint)) continue;
          // verify earliest signature for this mint (rough check)
          try {
            const sigsBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [mint, { limit: 50 }] });
            const sigsResp = await axios.post(HELIUS_RPC, sigsBody, { headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {}), timeout: 10000 });
            const sigs = (sigsResp.data && (sigsResp.data.result || sigsResp.data)) || [];
            if (!Array.isArray(sigs) || sigs.length === 0) continue;
            const earliest = sigs[sigs.length - 1];
            const isEarliest = earliest && (earliest.signature === signature || earliest.signature === signature + '');
            if (!isEarliest) {
              // not the earliest known signature in this limited window
              continue;
            }

            // accept as real new token
            seen.add(mint);
            console.log('\n=== Helius WS NEW TOKEN (accepted):', mint, 'signature:', signature, '===');
            try { console.log('firstTx (short):', JSON.stringify({ signature, slot: value.slot || (value && value.slot) || null, logs: logs.slice(0,10) }, null, 2)); } catch(e){}

            // Enrich with DexScreener pair search (best-effort)
            try {
              const sresp = await axios.get(DEX_SEARCH + '&q=' + mint, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 8000 });
              const sp = sresp.data && sresp.data.pairs || [];
              if (Array.isArray(sp) && sp.length) console.log('dex matches (sample):', JSON.stringify(sp.slice(0,3), null, 2));
            } catch(e){}

            // Forward to buy channel(s)
            console.log('FORWARDING (WS) TO BUY CHANNELS:', BUY_CHANNEL_TARGETS.join(','), '->', mint);
          } catch (e) {
            // continue
          }
        }
      } catch (e) {
        // ignore tx fetch failures
      }
    });

    ws.on('error', (err) => { console.error('Helius WS error', err && err.message || err); });
    // close WS cleanly when main finishes
    setTimeout(()=>{ try{ ws.terminate(); console.error('Helius WS terminated'); }catch(e){} }, RUN_MS + 2000);
  } catch (e) {
    console.error('Helius WS init failed:', e && e.message || e);
  }

  while (Date.now() < endAt) {
    console.error('\n[poll @', new Date().toISOString()+'] fetching search...');
    let resp;
    try {
      resp = await axios.get(DEX_SEARCH, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 10000 });
    } catch (e) {
      console.error('fetch search failed:', e.message || e);
      await new Promise(r=>setTimeout(r, INTERVAL_MS));
      continue;
    }
    const data = resp.data;
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const now = Date.now();
  for (const p of pairs) {
      try {
        if (!p || String(p.chainId || '').toLowerCase() !== 'solana') continue;
        if (!p.pairCreatedAt) continue;
        const created = Number(p.pairCreatedAt);
        if (isNaN(created)) continue;
        if (created < (now - TH_MS)) continue;
        // volume & liquidity thresholds (>=0)
        const vol = Number((p.volume && (p.volume.h24 || p.volume.h1 || p.volume.m5)) || 0);
        const liq = Number((p.liquidity && (p.liquidity.usd || p.liquidity)) || 0);
        if (!(vol >= 0 && liq >= 0)) continue;
        const pairAddress = p.pairAddress || p.pairAddress;
        if (!pairAddress) continue;

        // candidate tokens: base and quote tokens (we'll check both addresses on-chain)
        const candidates = [];
        if (p.baseToken && p.baseToken.address) candidates.push({ role: 'base', address: p.baseToken.address, symbol: p.baseToken.symbol, name: p.baseToken.name });
        if (p.quoteToken && p.quoteToken.address) candidates.push({ role: 'quote', address: p.quoteToken.address, symbol: p.quoteToken.symbol, name: p.quoteToken.name });

        for (const tok of candidates) {
          const tokenKey = `${pairAddress}:${tok.address}`;
          if (seen.has(tokenKey)) continue;

          // --- ON-CHAIN CHECK: use Helius RPC to find earliest signature and inspect transaction ---
          try {
            const sigsBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [tok.address, { limit: 50 }] });
            const sigsResp = await axios.post(HELIUS_RPC, sigsBody, { headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {}), timeout: 10000 });
            const sigs = (sigsResp.data && (sigsResp.data.result || sigsResp.data)) || [];
            if (!Array.isArray(sigs) || sigs.length === 0) {
              // no on-chain activity yet
              continue;
            }

            // assume signatures are returned newest-first; pick the last one as earliest
            const earliest = sigs[sigs.length - 1];
            const earliestSlotTime = earliest && (earliest.blockTime || earliest.blocktime || earliest.block_time || 0);
            if (!earliestSlotTime) {
              // try take first element timestamp instead
            }

            const earliestTs = (earliestSlotTime ? (earliestSlotTime * 1000) : Date.now());
            if (earliestTs < (Date.now() - TH_MS)) {
              // token too old (outside lookback)
              continue;
            }

            // pairCreatedAt check: ensure pairCreatedAt exists and is close to earliestTx
            const pairCreatedAtNum = Number(p.pairCreatedAt || 0);
            if (!pairCreatedAtNum || Math.abs(pairCreatedAtNum - earliestTs) > MAX_PAIR_EARLIEST_DIFF_MS) {
              // difference too large — mark as old / skip
              continue;
            }

            // fetch the earliest transaction to inspect instructions/logs
            const txBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [earliest.signature || earliest.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] });
            const txResp = await axios.post(HELIUS_RPC, txBody, { headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {}), timeout: 10000 });
            const tx = txResp.data && (txResp.data.result || txResp.data);

            // determine if this tx looks like token creation (initializeMint/mintTo) or first pool/swap
            let looksLikeCreation = false;
            try {
              const meta = tx && (tx.meta || tx.transaction && tx.meta);
              const msg = tx && (tx.transaction && tx.transaction.message || tx.transaction);
              const logMsgs = meta && meta.logMessages || [];

              // check log messages for common SPL token markers (fast heuristic)
              if (Array.isArray(logMsgs)) {
                for (const m of logMsgs) {
                  if (!m) continue;
                  const lm = String(m).toLowerCase();
                  if (lm.includes('initializemint') || lm.includes('mintto') || lm.includes('create account') || lm.includes('initialize account')) { looksLikeCreation = true; break; }
                }
              }

              // Protocol-aware parsed instruction check (more accurate)
              if (!looksLikeCreation && msg && Array.isArray(msg.instructions)) {
                for (const instr of msg.instructions) {
                  const progId = String(instr.programId || instr.program || '').toLowerCase();
                  const progName = String(instr.program || '').toLowerCase();
                  const parsed = instr.parsed || instr;
                  const parsedType = (parsed && (parsed.type || (parsed.parsed && parsed.parsed.type))) || '';

                  // direct parsed types
                  if (String(parsedType).toLowerCase().includes('initializemint') || String(parsedType).toLowerCase().includes('mintto')) { looksLikeCreation = true; break; }

                  // AMM-specific: check if programId matches known AMM program IDs or program name contains known AMM names
                  if (KNOWN_AMM_PROGS.length && KNOWN_AMM_PROGS.includes(progId)) { looksLikeCreation = true; break; }
                  if (KNOWN_AMM_NAMES.length && KNOWN_AMM_NAMES.some(n=>progName.includes(n))) { looksLikeCreation = true; break; }

                  // fallback: pattern match for swap/addliquidity keywords in parsed type or instruction data
                  if (String(parsedType).toLowerCase().includes('swap') || String(parsedType).toLowerCase().includes('addliquidity') || String(parsedType).toLowerCase().includes('amm')) { looksLikeCreation = true; break; }
                }
              }
            } catch (e) {
              // proceed conservatively
            }

            if (!looksLikeCreation) {
              // not a true mint / first-swap / pool creation
              continue;
            }

            // Looks like a real new token creation / first liquidity - accept and enrich
            seen.add(tokenKey);
            console.log('\n=== REAL NEW TOKEN (accepted):', tok.address, tok.symbol || '', '('+tok.role+') ===');
            console.log('pairAddress:', pairAddress, 'pairUrl:', p.url);

            // Enrichment: DexScreener pair details
            try {
              const pairUrl = `${DEX_PAIR_BASE}/${pairAddress}`;
              const presp = await axios.get(pairUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 10000 });
              console.log('dexscreener pair snapshot:', JSON.stringify({ pairAddress: presp.data && presp.data.pairAddress, baseToken: presp.data && presp.data.baseToken, quoteToken: presp.data && presp.data.quoteToken, liquidity: presp.data && presp.data.liquidity, volume: presp.data && presp.data.volume }, null, 2));
            } catch(e) {
              console.error('dex pair fetch failed:', e.message || e);
            }

            // Enrichment: Helius token supply
            try {
              const supplyBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [tok.address] });
              const supResp = await axios.post(HELIUS_RPC, supplyBody, { headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {}), timeout: 10000 });
              console.log('tokenSupply:', JSON.stringify(supResp.data && supResp.data.result || supResp.data, null, 2));
            } catch(e) {
              console.error('tokenSupply failed:', e.message || e);
            }

            // Enrichment: include first transaction detail
            try { console.log('firstTx:', JSON.stringify(tx, null, 2)); } catch(e){}

            // Forward to buy channel(s) (mocked by logging)
            console.log('FORWARDING TO BUY CHANNELS:', BUY_CHANNEL_TARGETS.join(','), '->', tok.address);

          } catch (e) {
            console.error('on-chain enrichment error for', tok.address, e.message || e);
          }
        }
        // fetch pair details
        const pairUrl = `${DEX_PAIR_BASE}/${pairAddress}`;
        try {
          const presp = await axios.get(pairUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 10000 });
          console.log('pair details snapshot:');
          const pd = presp.data;
          // print selected fields
          console.log(JSON.stringify({ pairAddress: pd.pairAddress || pairAddress, labels: pd.labels, baseToken: pd.baseToken, quoteToken: pd.quoteToken, priceUsd: pd.priceUsd, priceNative: pd.priceNative, volume: pd.volume, liquidity: pd.liquidity, txns: pd.txns, info: pd.info, pairCreatedAt: pd.pairCreatedAt }, null, 2));
        } catch (e) {
          console.error('failed to fetch pair details:', e.message || e);
        }
      } catch (e) {
        // continue
      }
    }

    await new Promise(r=>setTimeout(r, INTERVAL_MS));
  }

  console.error('\nDone listening. seen pairs count:', seen.size);
})();
