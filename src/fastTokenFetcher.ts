import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import { filterTokensByStrategy } from './bot/strategy';
import { createClient } from 'redis';
import { normalizeStrategy } from './utils/strategyNormalizer';
import { registerBuyWithTarget } from './bot/strategy';
import { extractTradeMeta } from './utils/tradeMeta';
import { unifiedBuy } from './tradeSources';
import { fetchDexScreenerTokens, fetchSolanaFromCoinGecko } from './utils/tokenUtils';
import { JUPITER_QUOTE_API, HELIUS_RPC_URL, SOLSCAN_API_URL, HELIUS_PARSE_HISTORY_URL } from './config';
import { getCoinData as getPumpData } from './pump/api';
import { existsSync, mkdirSync } from 'fs';
import fs from 'fs';
const fsp = fs.promises;
import { saveUsers, writeJsonFile } from './bot/helpers';
import path from 'path';

type UsersMap = Record<string, any>;

// Redis-based dedupe for short-lived processing (optional, requires REDIS_URL)
let __redisClient: any = null;
async function getRedisClient() {
  if (__redisClient) return __redisClient;
  try {
    const url = process.env.REDIS_URL || process.env.REDIS_URI || undefined;
    const client = createClient(url ? { url } : undefined);
    client.on('error', (e: any) => {});
    await client.connect();
    __redisClient = client;
    return __redisClient;
  } catch (e) {
    __redisClient = null;
    return null;
  }
}

async function isProcessedGlobal(key: string) {
  try {
    const c = await getRedisClient();
    if (!c) return false;
    const v = await c.get(`mint:processed:${key}`);
    return !!v;
  } catch (e) { return false; }
}

async function markProcessedGlobal(key: string, ttlSec = 60) {
  try {
    const c = await getRedisClient();
    if (!c) return false;
    await c.setEx(`mint:processed:${key}`, Math.max(1, Math.floor(ttlSec)), '1');
    return true;
  } catch (e) { return false; }
}

const DEXBOOSTS = process.env.DEXSCREENER_API_ENDPOINT || 'https://api.dexscreener.com/token-boosts/latest/v1';

export function hashTokenAddress(addr: string) {
  return String(addr || '').toLowerCase().trim();
}

async function ensureSentDir() {
  const sent = path.join(process.cwd(), 'sent_tokens');
  try {
    await fsp.mkdir(sent, { recursive: true });
  } catch {}
  return sent;
}

export async function readSentHashes(userId: string): Promise<Set<string>> {
  try {
  const sentDir = await ensureSentDir();
    const file = path.join(sentDir, `${userId}.json`);
    const stat = await fsp.stat(file).catch(() => false);
    if (!stat) return new Set();
    const data = JSON.parse(await fsp.readFile(file, 'utf8')) as any[];
    return new Set((data || []).map(d => d.hash).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

export async function appendSentHash(userId: string, hash: string) {
  try {
  const sentDir = await ensureSentDir();
    const file = path.join(sentDir, `${userId}.json`);
    let arr: any[] = [];
    try {
      const stat = await fsp.stat(file).catch(() => false);
      if (stat) {
        arr = JSON.parse(await fsp.readFile(file, 'utf8')) || [];
      }
    } catch {}
    arr.push({ hash, time: Date.now() });
    // write atomically via helper queue
    await writeJsonFile(file, arr.slice(-500)).catch(() => {});
  } catch (e) {}
}

/**
 * Start fast polling of DexScreener boosts endpoint and prioritize users flagged in their strategy.
 * Prioritized users: user.strategy.priority === true or user.strategy.priorityRank > 0
 */
export function startFastTokenFetcher(users: UsersMap, telegram: any, options?: { intervalMs?: number }) {
  const intervalMs = options?.intervalMs || 1000;
  const perUserLimit = (options as any)?.perUserLimit || 1; // max messages per interval
  const batchLimit = (options as any)?.batchLimit || 20; // tokens per user per interval
  let running = true;

  const lastSent: Map<string, number> = new Map();

  async function loop() {
    while (running) {
      try {
        // Fetch & filter tokens for all users using shared cache
        const perUserTokens = await fetchAndFilterTokensForUsers(users, { limit: 200, force: false });

        // Build prioritized list ordered by priorityRank desc then priority boolean
        const priorityUsers = Object.keys(users)
          .filter(uid => {
            const u = users[uid];
            return u && u.strategy && (u.strategy.priority === true || (u.strategy.priorityRank && u.strategy.priorityRank > 0));
          })
          .sort((a, b) => ( (users[b].strategy?.priorityRank || 0) - (users[a].strategy?.priorityRank || 0) ));

        // First process priority users, then regular users
        const processOrder = [...priorityUsers, ...Object.keys(users).filter(u => !priorityUsers.includes(u))];

        for (const uid of processOrder) {
          try {
            const u = users[uid];
            if (!u || !u.strategy || u.strategy.enabled === false) continue;
            const matches = perUserTokens[uid] || [];
            if (!matches.length) continue;

            // rate limiting: allow perUserLimit messages per interval
            const last = lastSent.get(uid) || 0;
            if (Date.now() - last < intervalMs * (perUserLimit)) {
              // skip this user this iteration
              continue;
            }

            // limit tokens per user per interval
            const tokensToSend = matches.slice(0, batchLimit);

            // Filter out tokens already sent (sent hashes)
            const sent = await readSentHashes(uid);
            const filtered = tokensToSend.filter(t => {
              const addr = t.tokenAddress || t.address || t.mint || t.pairAddress || '';
              const h = hashTokenAddress(addr);
              return addr && !sent.has(h);
            });
            if (!filtered.length) continue;

            // Send notifications in a batch (one message with multiple tokens or multiple messages)
            for (const token of filtered) {
              const addr = token.tokenAddress || token.address || token.mint || token.pairAddress || '';
              const h = hashTokenAddress(addr);
              try {
                const msg = `🚀 Token matched: ${token.description || token.name || addr}\nAddress: ${addr}`;
                await telegram.sendMessage(uid, msg);
                await appendSentHash(uid, h);
              } catch (e) {
                // ignore send errors per token
              }
            }

            // Optionally auto-buy for users with autoBuy enabled
            if (u.strategy.autoBuy !== false && Number(u.strategy.buyAmount) > 0) {
                    for (const token of filtered) {
                const addr = token.tokenAddress || token.address || token.mint || token.pairAddress || '';
                try {
                  const finalStrategy = normalizeStrategy(u.strategy);
                  const finalOk = await (require('./bot/strategy').filterTokensByStrategy([token], finalStrategy));
                  if (!finalOk || finalOk.length === 0) continue;
                  const amount = Number(u.strategy.buyAmount);
                  const result = await unifiedBuy(addr, amount, u.secret);
                  if (result && ((result as any).tx || (result as any).success)) {
                    try { await registerBuyWithTarget(u, { address: addr, price: token.price || token.priceUsd }, result, u.strategy.targetPercent || 10); } catch {}
                    const { fee, slippage } = extractTradeMeta(result, 'buy');
                    u.history = u.history || [];
                    const resTx = (result as any)?.tx ?? '';
                    u.history.push(`AutoBuy: ${addr} | ${amount} SOL | Tx: ${resTx} | Fee: ${fee ?? 'N/A'} | Slippage: ${slippage ?? 'N/A'}`);
                    try { saveUsers(users); } catch {}
                    // notify user about executed buy
                    try { await telegram.sendMessage(uid, `✅ AutoBuy executed for ${addr}\nTx: ${resTx}`); } catch {}
                    }
                } catch (e) {
                  // ignore per-token buy errors
                }
              }
            }

            lastSent.set(uid, Date.now());
          } catch (e) {
            // per-user loop error: continue
            continue;
          }
        }

      } catch (err) {
        // ignore fetch loop errors
      }
      await sleep(intervalMs);
    }
  }

  loop();

  return {
    stop: () => { running = false; }
  };
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

// =========================
// New: fetch and filter tokens per-user
// =========================
let __global_fetch_cache: any[] = [];
let __global_fetch_ts = 0;
const __GLOBAL_FETCH_TTL = 1000 * 60 * 1; // 1 minute default

// Aggregate quick candidate sources into a unified list of { mint }
async function getUnifiedCandidates(limit: number) {
  const candidates: string[] = [];
  try {
    // 1) Helius WS buffer + recent events
    try {
      const { getRecentHeliusEvents } = require('./heliusWsListener');
      const evs = getRecentHeliusEvents();
      if (Array.isArray(evs)) {
        for (const e of evs) {
          const m = e && (e.mint || (e.parsed && e.parsed.info && e.parsed.info.mint));
          if (m) candidates.push(m);
          if (candidates.length >= limit) break;
        }
      }
    } catch (e) {}

    // 2) DexScreener boosts
    try {
      const raw = await fetchDexBoostsRaw(2000);
      let data: any[] = [];
      if (raw) data = Array.isArray(raw) ? raw : (raw.data || raw.pairs || raw.items || []);
      for (const it of data) {
        const m = extractMintFromItemLocal(it);
        if (m) candidates.push(m);
        if (candidates.length >= limit) break;
      }
  } catch (e) {}

    // 3) fetchLatest5FromAllSources for extra corroboration
    try {
      const subs = await fetchLatest5FromAllSources(Math.max(5, limit));
      for (const arr of [subs.heliusEvents || [], subs.dexTop || [], subs.heliusHistory || []]) {
        for (const m of arr) {
          if (m) candidates.push(m);
          if (candidates.length >= limit) break;
        }
        if (candidates.length >= limit) break;
      }
    } catch (e) {}

  } catch (e) {}

  const uniq = Array.from(new Set(candidates)).slice(0, limit || 200);
  return uniq.map(m => ({ mint: m }));
}

/**
 * Fetch tokens from common sources (DexScreener, CoinGecko fallback) once,
 * then filter tokens per user based on their normalized strategy.
 * Returns a map: { [userId]: tokens[] }
 */
export async function fetchAndFilterTokensForUsers(users: UsersMap, opts?: { limit?: number, force?: boolean }): Promise<Record<string, any[]>> {
  const now = Date.now();
  if (!opts?.force && __global_fetch_cache.length && (now - __global_fetch_ts) < __GLOBAL_FETCH_TTL) {
    // use cache
  } else {
    try {
  const limit = opts?.limit || 200;
  // fetch unified candidates from multiple sources (DexScreener + Helius events/history + parse + RPC)
  __global_fetch_cache = await getUnifiedCandidates(limit).catch(async (e: any) => {
    try {
      const { fetchUnifiedTokens } = require('./utils/tokenUtils');
      return await fetchUnifiedTokens('solana', { limit: String(limit) } as any);
    } catch (ee) { return []; }
  });
      __global_fetch_ts = Date.now();
    } catch (e) {
      // fallback: try coinGecko single fetch
      try {
        const cg = await fetchSolanaFromCoinGecko();
        __global_fetch_cache = cg ? [cg] : [];
        __global_fetch_ts = Date.now();
      } catch {
        __global_fetch_cache = [];
      }
    }
  }

  const result: Record<string, any[]> = {};
  const normalizedMap: Record<string, any> = {};
  // pre-normalize strategies
  for (const uid of Object.keys(users)) {
    const u = users[uid];
    if (!u || !u.strategy) continue;
    try {
      normalizedMap[uid] = normalizeStrategy(u.strategy);
    } catch {
      normalizedMap[uid] = u.strategy;
    }
  }

  // For each user, filter tokens using filterTokensByStrategy (robust)
  for (const uid of Object.keys(normalizedMap)) {
    const strat = normalizedMap[uid];
    if (!strat || strat.enabled === false) {
      result[uid] = [];
      continue;
    }
    try {
      // Official enrichment: for safety, check a small sample using Solana RPC + Jupiter.
      // We do this when user has autoBuy enabled or buyAmount > 0 to avoid unnecessary calls.
      const needOfficial = (typeof strat.buyAmount === 'number' && strat.buyAmount > 0) || strat.autoBuy !== false;
      let workCache = __global_fetch_cache;
      if (needOfficial && Array.isArray(workCache) && workCache.length > 0) {
  const sampleSize = Number(process.env.FASTFETCH_SAMPLE_SIZE || 40);
  const sample = workCache.slice(0, sampleSize);
  const { officialEnrich, checkOnChainActivity } = require('./utils/tokenUtils');
  const concurrency = Number(process.env.FASTFETCH_ENRICH_CONCURRENCY || 1);
        let idx = 0;
        async function worker() {
          while (idx < sample.length) {
            const i = idx++;
            const t = sample[i];
            try {
              // Gate expensive officialEnrich calls by a lightweight on-chain activity check
              // This avoids enriching memo-only/noise tokens and reduces 429s.
              const addr = t.tokenAddress || t.address || t.mint || t.pairAddress;
              if (!addr) continue;
              try {
                const oc = await checkOnChainActivity(addr);
                if (!oc || !oc.found) {
                  // skip heavy enrichment when no on-chain activity found
                  continue;
                }
              } catch (e) {
                // if on-chain check fails, skip to avoid extra load
                continue;
              }
              await officialEnrich(t, { amountUsd: Number(strat.buyAmount) || 50, timeoutMs: 4000 });
            } catch (e) {}
          }
        }
        const workers = Array.from({ length: Math.min(concurrency, sample.length) }, () => worker());
  const globalTimeoutMs = Number(process.env.FASTFETCH_GLOBAL_TIMEOUT_MS || 4000);
        await Promise.race([ Promise.all(workers), new Promise(res => setTimeout(res, globalTimeoutMs)) ]);
        workCache = [...sample, ...workCache.slice(sampleSize)];
      }
  const matches = await (require('./bot/strategy').filterTokensByStrategy(workCache, strat));
  result[uid] = Array.isArray(matches) ? matches : [];
    } catch (e) {
      result[uid] = [];
    }
  }

  return result;
}

// =========================
// Quick CLI: fast discovery + Helius_FAST enrichment
// =========================

async function fetchDexBoostsRaw(timeout = 3000) {
  try {
    const url = DEXBOOSTS;
    const res = await axios.get(url, { timeout });
    return res.data;
  } catch (e) {
    return null;
  }
}

function extractMintFromItemLocal(it: any): string | null {
  if (!it) return null;
  if (it.token && typeof it.token === 'object') {
    const t = it.token;
    return t.address || t.mint || null;
  }
  if (it.pair && typeof it.pair === 'object') {
    const p = it.pair;
    if (p.token && typeof p.token === 'object') return p.token.mint || p.token.address || null;
    if (p.baseToken && typeof p.baseToken === 'object') return p.baseToken.mint || p.baseToken.address || null;
    if (p.base && typeof p.base === 'object') return p.base.mint || p.base.address || null;
  }
  return it.tokenAddress || it.mint || it.address || null;
}

export async function heliusGetSignaturesFast(mint: string, heliusUrl: string, timeout = 2500, retries = 0) {
  const payload = { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [mint, { limit: 3 }] };
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await axios.post(heliusUrl, payload, { headers: { 'Content-Type': 'application/json' }, timeout });
      return res.data;
    } catch (e: any) {
      const status = e.response?.status;
      // If 429 or 5xx, consider retrying
      if (status && (status === 429 || (status >= 500 && status < 600)) && attempt < retries) {
        const backoff = 200 * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
        await new Promise((r) => setTimeout(r, backoff));
        attempt++;
        continue;
      }
      return { __error: status ? `http-${status}` : (e.message || 'error') };
    }
  }
  return { __error: 'unknown' };
}

// Handle a new mint event: attempt quick enrichment (first signature => blockTime) and log
// --- Helpers: lightweight helius/json-rpc wrapper and verification helpers
async function heliusRpc(method: string, params: any[] = [], timeout = 4000, retries = 0): Promise<any> {
  const heliusUrl = HELIUS_RPC_URL || process.env.HELIUS_FAST_RPC_URL;
  if (!heliusUrl) return { __error: 'no-helius-url' };
  const payload = { jsonrpc: '2.0', id: 1, method, params };
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await axios.post(heliusUrl, payload, { headers: { 'Content-Type': 'application/json' }, timeout });
      return res.data?.result ?? res.data;
    } catch (e: any) {
      const status = e.response?.status;
      if (status && (status === 429 || (status >= 500 && status < 600)) && attempt < retries) {
        const backoff = 200 * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
        await new Promise((r) => setTimeout(r, backoff));
        attempt++;
        continue;
      }
      return { __error: status ? `http-${status}` : (e.message || 'error') };
    }
  }
  return { __error: 'unknown' };
}

async function getParsedTransaction(signature: string) {
  return heliusRpc('getTransaction', [signature, { encoding: 'jsonParsed' }], 5000, 1);
}

async function getAccountInfo(pubkey: string) {
  return heliusRpc('getAccountInfo', [pubkey, { encoding: 'base64' }], 4000, 1);
}

async function getTokenSupply(pubkey: string) {
  return heliusRpc('getTokenSupply', [pubkey], 4000, 1);
}

function metadataPdaForMint(mint: string) {
  try {
    const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const mintPk = new PublicKey(mint);
    const seeds = [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mintPk.toBuffer()];
    return PublicKey.findProgramAddress(seeds, METADATA_PROGRAM).then(([p]) => p.toBase58());
  } catch (e) {
    return Promise.resolve(null);
  }
}

// Enhanced: handleNewMintEvent now performs deterministic verification and can optionally route to users
export async function handleNewMintEvent(mintOrObj: any, users?: UsersMap, telegram?: any) {
  const mint = typeof mintOrObj === 'string' ? mintOrObj : (mintOrObj?.mint || null);
  if (!mint) return null;
  try {
    const heliusUrl = process.env.HELIUS_FAST_RPC_URL || HELIUS_RPC_URL;
    if (!heliusUrl) { console.log('handleNewMintEvent: no helius url'); return null; }

    const r = await heliusGetSignaturesFast(mint, heliusUrl, 4000, 0);
    if (!r || (r as any).__error) { if ((r as any)?.__error) console.log(`Enrich ${mint} error: ${(r as any).__error}`); return null; }
    const arr = Array.isArray(r) ? r : ((r as any).result ?? r);
    if (!arr || !Array.isArray(arr) || arr.length === 0) return null;

    // compute earliest blockTime across signatures (Helius returns newest-first)
    let earliestBlockTime: number | null = null;
    let firstSignature: string | null = null;
    for (const entry of arr) {
      const sig = entry?.signature || entry?.txHash || entry?.tx_hash || null;
      let btv: any = entry?.blockTime ?? entry?.block_time ?? entry?.blocktime ?? entry?.timestamp ?? null;
      if (btv && btv > 1e12) btv = Math.floor(Number(btv) / 1000);
      if (btv) {
        const num = Number(btv);
        if (!earliestBlockTime || num < earliestBlockTime) {
          earliestBlockTime = num;
          firstSignature = sig;
        }
      }
    }

    // fallback: if no blockTime in signatures, try parsed tx for the last (earliest) signature
    if (!earliestBlockTime) {
      const sigTry = arr[arr.length - 1]?.signature || arr[arr.length - 1]?.txHash || null;
      if (sigTry) {
        try {
          const parsed = await getParsedTransaction(sigTry);
          const pbt = (parsed as any)?.blockTime ?? (parsed as any)?.result?.blockTime ?? (parsed as any)?.result?.block_time ?? (parsed as any)?.result?.blocktime ?? null;
          if (pbt) earliestBlockTime = Number(pbt > 1e12 ? Math.floor(pbt / 1000) : pbt);
          firstSignature = sigTry;
        } catch (e) {}
      }
    }

    if (!earliestBlockTime) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSeconds = nowSec - Number(earliestBlockTime);

    // verify metadata PDA and token supply
    const metadataPda = await metadataPdaForMint(mint);
    let metadataExists = false;
    if (metadataPda) {
      const acct = await getAccountInfo(metadataPda);
      if (acct && acct.value) metadataExists = true;
    }
    let supply: number | null = null;
    try {
      const sup = await getTokenSupply(mint);
      if (sup && sup.value && (sup.value.amount !== undefined)) supply = Number(sup.value.amount);
    } catch (e) {}

    const validated = metadataExists || (supply !== null && supply > 0);
    const detectedAtSec = (mintOrObj as any)?.detectedAtSec ?? Math.floor(Date.now() / 1000);
    const detection = { mint, firstBlockTime: earliestBlockTime, ageSeconds, metadataExists, supply, firstSignature, detectedAtSec };

    if (validated && users && telegram) {
      for (const uid of Object.keys(users)) {
        try {
          const u = users[uid];
          if (!u || !u.strategy || u.strategy.enabled === false) continue;
          const strat = normalizeStrategy(u.strategy);
          const tokenObj = { mint, address: mint, metadataExists, supply, firstBlockTime: detection.firstBlockTime, ageSeconds: detection.ageSeconds };
          const matches = await filterTokensByStrategy([tokenObj], strat);
          if (Array.isArray(matches) && matches.length) {
            try {
              const h = hashTokenAddress(mint);
              const msg = `🚀 New token for you: ${mint}\nAge(s): ${detection.ageSeconds ?? 'N/A'}\nMetadata: ${metadataExists}`;
              await telegram.sendMessage(uid, msg);
              await appendSentHash(uid, h);
            } catch (e) {}

            if (u.strategy.autoBuy !== false && Number(u.strategy.buyAmount) > 0) {
              try {
                const amount = Number(u.strategy.buyAmount);
                const result = await unifiedBuy(mint, amount, u.secret);
                if (result && ((result as any).tx || (result as any).success)) {
                  try { await registerBuyWithTarget(u, { address: mint, price: (tokenObj as any).price || 0 }, result, u.strategy.targetPercent || 10); } catch {}
                  const { fee, slippage } = extractTradeMeta(result, 'buy');
                  u.history = u.history || [];
                  const resTx = (result as any)?.tx ?? '';
                  u.history.push(`AutoBuy: ${mint} | ${amount} SOL | Tx: ${resTx} | Fee: ${fee ?? 'N/A'} | Slippage: ${slippage ?? 'N/A'}`);
                  try { saveUsers(users); } catch {}
                  try { await telegram.sendMessage(uid, `✅ AutoBuy executed for ${mint}\nTx: ${resTx}`); } catch {}
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    // log and return detection
    if (validated) console.log(`ValidatedNewMint: ${mint} firstBlockTime=${earliestBlockTime} ageSeconds=${ageSeconds} metadata=${metadataExists} supply=${supply}`);
    else console.log(`CandidateMint (unvalidated): ${mint} firstBlockTime=${earliestBlockTime} ageSeconds=${ageSeconds} metadata=${metadataExists} supply=${supply}`);
    return detection;
  } catch (e) {
    return null;
  }
}

export async function runFastDiscoveryCli(opts?: { topN?: number; timeoutMs?: number; concurrency?: number }) {
  const topN = opts?.topN ?? 10;
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const concurrency = opts?.concurrency ?? 3;
  const heliusUrl = process.env.HELIUS_FAST_RPC_URL || HELIUS_RPC_URL;

  console.log(`Running fast discovery: topN=${topN} timeoutMs=${timeoutMs} concurrency=${concurrency}`);
  const raw = await fetchDexBoostsRaw(timeoutMs);
  if (!raw) {
    console.error('Failed to fetch DexScreener boosts (empty/timeout)');
    return;
  }
  let data: any[] = [];
  if (Array.isArray(raw)) data = raw as any[];
  else data = raw.data || raw.pairs || [];
  if (!Array.isArray(data) || data.length === 0) {
    console.error('DexScreener returned no items');
    return;
  }

  const map = new Map<string, number>();
  for (const it of data) {
    const mint = extractMintFromItemLocal(it);
    if (!mint) continue;
    const liq = Number(it.liquidityUSD ?? it.liquidity ?? 0) || 0;
    if (!map.has(mint)) map.set(mint, liq);
    else map.set(mint, Math.max(map.get(mint)!, liq));
    if (map.size >= topN * 3) break;
  }

  const list = Array.from(map.entries()).map(([mint, liq]) => ({ mint, liq }));
  list.sort((a, b) => b.liq - a.liq);
  // restrict to Solana chain tokens only: many items include chainId
  const solTop = list.filter((x: any) => {
    // tokenAddress on Solana typically base58 and not 0x-prefixed
    const addr = String(x.mint || '').trim();
    if (!addr) return false;
    return !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44; // heuristic
  }).slice(0, topN);
  const top = solTop;
  console.log('Top candidates:');
  top.forEach((t, i) => console.log(`${i + 1}. ${t.mint} liquidity=${t.liq}`));

  const results: Array<any> = [];
  const batches: any[] = [];
  for (let i = 0; i < top.length; i += concurrency) batches.push(top.slice(i, i + concurrency));

  // Simple circuit-breaker per-host
  const hostState: Record<string, { recent429: number; cooldownUntil: number }> = {};

  function hostKey(u: string) {
    try { return new URL(u).host; } catch { return u; }
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // Helper: page getSignaturesForAddress via heliusRpc to collect up to max signatures (for deep verification)
  async function collectSignaturesFull(address: string, maxCollect = 2000) {
    const out: any[] = [];
    let before: string | null = null;
    const limit = 1000;
    for (let i = 0; i < 5 && out.length < maxCollect; i++) {
      try {
        const params: any[] = [address, { limit }];
        if (before) params[1].before = before;
        const res = await heliusRpc('getSignaturesForAddress', params, 5000, 0);
        const arr = Array.isArray(res) ? res : (res?.result ?? res);
        if (!Array.isArray(arr) || arr.length === 0) break;
        out.push(...arr);
        if (arr.length < limit) break;
        before = arr[arr.length - 1].signature || arr[arr.length - 1].txHash || null;
      } catch (e) { break; }
    }
    return out.slice(0, maxCollect);
  }
  for (const batch of batches) {
    await Promise.all(batch.map(async (t: any) => {
      try {
        if (!heliusUrl) { results.push({ mint: t.mint, error: 'no-helius-url' }); return; }
        const hk = hostKey(heliusUrl);
        const state = hostState[hk] || { recent429: 0, cooldownUntil: 0 };
        if (Date.now() < (state.cooldownUntil || 0)) {
          results.push({ mint: t.mint, error: 'host-cooldown' });
          hostState[hk] = state;
          return;
        }

        // Prefer a full paged signatures collection for accuracy (may be slower)
        let r: any = null;
        try {
          const full = await collectSignaturesFull(t.mint, 2000);
          if (Array.isArray(full) && full.length) r = full;
          else r = await heliusGetSignaturesFast(t.mint, heliusUrl, timeoutMs, 0);
        } catch (e) {
          r = await heliusGetSignaturesFast(t.mint, heliusUrl, timeoutMs, 0);
        }

        if (r && r.__error) {
          // handle HTTP 429 counting
          if (String(r.__error).includes('http-429')) {
            state.recent429 = (state.recent429 || 0) + 1;
            if (state.recent429 >= 3) {
              state.cooldownUntil = Date.now() + 10_000;
              state.recent429 = 0;
            }
          }

          // try alternate helius rpc if available
          const alt = HELIUS_RPC_URL;
          if (alt && alt !== heliusUrl) {
            const r2 = await heliusGetSignaturesFast(t.mint, alt, timeoutMs, 0);
            if (r2 && r2.__error) {
              // try direct rpc via heliusRpc
              try {
                const r3 = await heliusRpc('getSignaturesForAddress', [t.mint, { limit: 3 }], timeoutMs, 0);
                const arr3 = Array.isArray(r3) ? r3 : (r3?.result ?? r3);
                const f3 = Array.isArray(arr3) && arr3[0] ? arr3[0] : null;
                const bt3 = f3?.blockTime ?? f3?.block_time ?? f3?.blocktime ?? null;
                if (bt3) {
                    results.push({ mint: t.mint, firstBlockTime: Number(bt3), ageSeconds: nowSec - Number(bt3), source: 'helius-rpc', earliestSignature: (f3 && (f3.signature || f3.txHash || f3.tx_hash)) || null });
                  hostState[hk] = state;
                  return;
                }
              } catch (e) {
                // ignore
              }

              // final fallback to solscan if configured
              try {
                const solscanUrl = `${SOLSCAN_API_URL}/token/${t.mint}/transactions`;
                const sres = await axios.get(solscanUrl, { timeout: timeoutMs });
                const arr = sres.data ?? [];
                const first = Array.isArray(arr) ? arr[0] : null;
                const bt = first?.blockTime || first?.time || first?.timestamp || null;
          if (bt) {
            results.push({ mint: t.mint, firstBlockTime: Number(bt), ageSeconds: nowSec - Number(bt), source: 'solscan', earliestSignature: (first && (first.signature || first.txHash || first.tx_hash)) || null });
                  hostState[hk] = state;
                  return;
                }
              } catch (e) {
                // ignore
              }

              results.push({ mint: t.mint, error: r.__error });
              hostState[hk] = state;
              return;
            }

            // r2 succeeded: compute earliest blockTime from r2
            const arr2 = Array.isArray(r2) ? r2 : (r2.result ?? r2);
            if (!arr2 || !Array.isArray(arr2) || arr2.length === 0) {
              results.push({ mint: t.mint, error: 'no-signatures' });
              hostState[hk] = state;
              return;
            }

            let bt2: any = null;
            let sig2: string | null = null;
            try {
              const withBt2 = arr2.filter((x: any) => x && (x.blockTime || x.block_time || x.blocktime));
              if (withBt2.length) {
                let min = withBt2[0];
                for (const it of withBt2) {
                  const b = it.blockTime ?? it.block_time ?? it.blocktime ?? 0;
                  if (b && b < (min.blockTime ?? min.block_time ?? min.blocktime ?? Infinity)) min = it;
                }
                bt2 = min.blockTime ?? min.block_time ?? min.blocktime ?? null;
                sig2 = min.signature || min.txHash || min.tx_hash || null;
              } else {
                const last = arr2[arr2.length - 1];
                bt2 = last?.blockTime ?? last?.block_time ?? last?.blocktime ?? null;
                sig2 = last?.signature || last?.txHash || last?.tx_hash || null;
              }
            } catch (e) {}

            // If we have a signature, always try parsed tx to get the most accurate (possibly earlier) blockTime.
            if (sig2) {
              try {
                const parsed2 = await getParsedTransaction(sig2);
                const pbt2 = parsed2?.blockTime ?? parsed2?.result?.blockTime ?? parsed2?.result?.block_time ?? parsed2?.result?.blocktime ?? null;
                if (pbt2) {
                  // prefer the earlier timestamp (smallest)
                  const pnum = Number(pbt2 > 1e12 ? Math.floor(pbt2 / 1000) : pbt2);
                  if (!bt2 || pnum < Number(bt2)) bt2 = pnum;
                }
              } catch (e) {}
            }

            if (bt2 && bt2 > 1e12) bt2 = Math.floor(Number(bt2) / 1000);
            if (!bt2) {
              results.push({ mint: t.mint, error: 'no-blockTime' });
              hostState[hk] = state;
              return;
            }

                  results.push({ mint: t.mint, firstBlockTime: Number(bt2), ageSeconds: nowSec - Number(bt2), source: 'helius-rpc', earliestSignature: sig2 || null });
            hostState[hk] = state;
            return;
          }

          // if no alt configured or alt equals heliusUrl, just emit the original error
          results.push({ mint: t.mint, error: r.__error });
          hostState[hk] = state;
          return;
        }

        // success path: r contains signatures
        const arr = Array.isArray(r) ? r : (r.result ?? r);
        if (!arr || !Array.isArray(arr) || arr.length === 0) {
          results.push({ mint: t.mint, error: 'no-signatures' });
          return;
        }

        // compute earliest blockTime across signatures
        let minBt: number | null = null;
        let earliestSig: string | null = null;
        for (const s of arr) {
          let btv = s?.blockTime ?? s?.block_time ?? s?.blocktime ?? s?.timestamp ?? null;
          if (btv && btv > 1e12) btv = Math.floor(Number(btv) / 1000);
          if (btv && (!minBt || Number(btv) < minBt)) {
            minBt = Number(btv);
            earliestSig = s?.signature || s?.txHash || s?.tx_hash || null;
          }
        }

        // If we found an earliestSig from signatures, verify with getTransaction (it may be earlier or more accurate)
        if (earliestSig) {
          try {
            const parsed = await getParsedTransaction(earliestSig);
            const pbt = parsed?.blockTime ?? parsed?.result?.blockTime ?? parsed?.result?.block_time ?? parsed?.result?.blocktime ?? null;
            if (pbt) {
              const pnum = Number(pbt > 1e12 ? Math.floor(pbt / 1000) : pbt);
              if (!minBt || pnum < minBt) minBt = pnum;
            }
          } catch (e) {}
        } else {
          const sigTry = arr[arr.length - 1]?.signature || arr[arr.length - 1]?.txHash || null;
          if (sigTry) {
            try {
              const parsed = await getParsedTransaction(sigTry);
              const pbt = parsed?.blockTime ?? parsed?.result?.blockTime ?? parsed?.result?.block_time ?? parsed?.result?.blocktime ?? null;
              if (pbt) minBt = Number(pbt > 1e12 ? Math.floor(pbt / 1000) : pbt);
              earliestSig = sigTry;
            } catch (e) {}
          }
        }

        if (!minBt) {
          results.push({ mint: t.mint, error: 'no-blockTime' });
          hostState[hk] = state;
          return;
        }

        // If token looks very young (<=10min), deep-verify by paging full signature history to avoid false-youth
        try {
          const ageNow = nowSec - Number(minBt);
          if (ageNow <= 600) {
            const fullSigs = await collectSignaturesFull(t.mint, 2000);
            if (Array.isArray(fullSigs) && fullSigs.length) {
              let fullMin: number | null = null;
              let candidateSig: string | null = null;
              for (const s of fullSigs) {
                let btv = s?.blockTime ?? s?.block_time ?? s?.blocktime ?? s?.timestamp ?? null;
                if (btv && btv > 1e12) btv = Math.floor(Number(btv) / 1000);
                if (btv && (!fullMin || Number(btv) < fullMin)) { fullMin = Number(btv); candidateSig = s?.signature || s?.txHash || s?.tx_hash || null; }
              }
              if (candidateSig) {
                try {
                  const parsed = await getParsedTransaction(candidateSig);
                  const pbt = parsed?.blockTime ?? parsed?.result?.blockTime ?? parsed?.result?.block_time ?? parsed?.result?.blocktime ?? null;
                  if (pbt) {
                    const pnum = Number(pbt > 1e12 ? Math.floor(pbt / 1000) : pbt);
                    if (!fullMin || pnum < fullMin) fullMin = pnum;
                  }
                } catch (e) {}
              }
              if (fullMin && (!minBt || fullMin < minBt)) minBt = fullMin;
            }
          }
        } catch (e) {}

  results.push({ mint: t.mint, firstBlockTime: Number(minBt), ageSeconds: nowSec - Number(minBt), source: 'helius-fast', earliestSignature: earliestSig || null });
        hostState[hk] = state;
        return;
      } catch (e) {
        results.push({ mint: t.mint, error: 'exception' });
        return;
      }
    }));

    // small pause between batches
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\nFast enrichment results (JSON lines):');
  for (const r of results) {
    console.log(JSON.stringify(r));
  }
}

// If executed directly, run with defaults
if (require && require.main === module) {
  (async () => {
    await runFastDiscoveryCli({ topN: 10, timeoutMs: 3000, concurrency: 3 });
  })();
}

// Fetch latest N unique mints from multiple sources: Helius WS recent events, DexScreener boosts, and Solana RPC (via Helius parse-history)
export async function fetchLatest5FromAllSources(n = 5) {
  const axiosLocal = axios;
  const heliusEvents: string[] = [];
  try {
    const { getRecentHeliusEvents } = require('./heliusWsListener');
    const evs = getRecentHeliusEvents();
    for (const e of evs) {
      if (e && e.mint) heliusEvents.push(e.mint);
      if (heliusEvents.length >= n) break;
    }
  } catch (e) {}

  // DexScreener top N
  const dex: string[] = [];
  try {
    const raw = await fetchDexBoostsRaw(3000);
    let data: any[] = [];
    if (raw) data = Array.isArray(raw) ? raw : (raw.data || raw.pairs || []);
    for (const it of data) {
      const m = extractMintFromItemLocal(it);
      if (m && !dex.includes(m)) dex.push(m);
      if (dex.length >= n) break;
    }
  } catch (e) {}

  // Solana parse history approach: use HELIUS_PARSE_HISTORY_URL template if available
  const heliusHistory: string[] = [];
  try {
  const parseUrlTemplate = HELIUS_PARSE_HISTORY_URL;
    if (parseUrlTemplate) {
      // if parseHistory supports an endpoint to query recent addresses, we try a small approach: query top dex list mints for their first tx
      const candidates = dex.slice(0, Math.max(n, 10));
      for (const c of candidates) {
        try {
          const url = parseUrlTemplate.replace('{address}', c);
          const res = await axiosLocal.get(url, { timeout: 2000 });
          // if it returns array, and first tx exists, consider it a candidate
          const arr = res.data ?? [];
          if (Array.isArray(arr) && arr.length) {
            heliusHistory.push(c);
          }
        } catch (err) {}
        if (heliusHistory.length >= n) break;
      }
    }
  } catch (e) {}

  return {
    heliusEvents: Array.from(new Set(heliusEvents)).slice(0, n),
    dexTop: dex.slice(0, n),
    heliusHistory: Array.from(new Set(heliusHistory)).slice(0, n),
  };
}

// If run directly with command `node fastTokenFetcher.js latest` print latest 5 from each source
if (require && require.main === module) {
  const arg = process.argv[2] || '';
  if (arg === 'latest') {
    (async () => {
      const res = await fetchLatest5FromAllSources(5);
      console.log('Latest from Helius WS buffer:', res.heliusEvents);
      console.log('Top from DexScreener:', res.dexTop);
      console.log('Helius parse-history hits:', res.heliusHistory);
      process.exit(0);
    })();
  }
}
