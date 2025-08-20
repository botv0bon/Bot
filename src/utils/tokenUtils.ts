// Smart field-specific formatting for token stats
function fmtField(val: number | string | undefined | null, field: string): string {
  if (val === undefined || val === null || val === '-' || val === '' || val === 'N/A' || val === 'null' || val === 'undefined') return 'Not available';
  let num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return String(val);
  switch (field) {
    case 'price':
      if (Math.abs(num) >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
      if (Math.abs(num) >= 0.01) return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
      return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
    case 'marketCap':
    case 'liquidity':
    case 'volume':
      return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'holders':
    case 'age':
      return Math.round(num).toLocaleString();
    default:
      return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';


// ========== General Constants ==========
const EMPTY_VALUES = [undefined, null, '-', '', 'N/A', 'null', 'undefined'];

// Unified field map (easily extendable)
const FIELD_MAP: Record<string, string[]> = {
  marketCap: ['marketCap', 'fdv', 'totalAmount', 'amount'],
  liquidity: ['liquidity', 'liquidityUsd'],
  volume: ['volume', 'amount', 'totalAmount'],
  age: ['age', 'createdAt'],
};

const missingFieldsLog: Set<string> = new Set();



// Extract field value (supports nested paths)
export function getField(token: any, ...fields: string[]): any {
  for (let f of fields) {
    const mapped = FIELD_MAP[f] || [f];
    for (const mf of mapped) {
      // دعم المسارات المتداخلة
      const path = mf.split('.');
      let val = token;
      for (const key of path) {
        if (val == null) break;
        val = val[key];
      }
      if (!EMPTY_VALUES.includes(val)) return extractNumeric(val, val);
      if (mf in token && !EMPTY_VALUES.includes(token[mf])) return extractNumeric(token[mf], token[mf]);
    }
  }
  if (fields.length > 0) missingFieldsLog.add(fields[0]);
  return undefined;
}

// دالة لعرض الحقول المفقودة (للمطور أو المستخدم)
export function getMissingFields(): string[] {
  return Array.from(missingFieldsLog);
}

// Extract a number from any value (helper)
function extractNumeric(val: any, fallback?: number): number | undefined {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
  if (val && typeof val === 'object') {
    for (const k of ['usd','h24','amount','value','total','native','sol']) {
      if (typeof val[k] === 'number' && !isNaN(val[k])) return val[k];
    }
    for (const k in val) if (typeof val[k] === 'number' && !isNaN(val[k])) return val[k];
  }
  return fallback;
}

// Parse duration input (supports numbers and strings like '30s','5m','2h')
export function parseDuration(v: string | number | undefined | null): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') {
    // Backwards compatibility: plain numbers are treated as minutes (legacy behaviour)
    return Math.floor(Number(v) * 60);
  }
  const s = String(v).trim().toLowerCase();
  const match = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)?$/);
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = match[2] || 'm';
  switch (unit) {
    case 's': case 'sec': case 'secs': case 'seconds': return Math.floor(n);
    case 'm': case 'min': case 'mins': case 'minutes': return Math.floor(n * 60);
    case 'h': case 'hr': case 'hrs': case 'hours': return Math.floor(n * 3600);
    case 'd': case 'day': case 'days': return Math.floor(n * 86400);
    default: return Math.floor(n * 60);
  }
}


export async function retryAsync<T>(fn: () => Promise<T>, retries = 0, delayMs = 2000): Promise<T> {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const retryAfter = err?.response?.headers?.['retry-after'];
      const wait = retryAfter ? Number(retryAfter) * 1000 : delayMs;
      if (i < retries - 1) await new Promise(res => setTimeout(res, wait));
    }
  }
  throw lastErr;
}


// ========== Fetch token data from CoinGecko and DexScreener ==========
export async function fetchSolanaFromCoinGecko(): Promise<any> {
  const url = 'https://api.coingecko.com/api/v3/coins/solana';
  try {
    return await retryAsync(async () => {
      const response = await axios.get(url);
      const data = response.data;
      return {
        name: data.name,
        symbol: data.symbol,
        priceUsd: data.market_data?.current_price?.usd,
        marketCap: data.market_data?.market_cap?.usd,
        volume: data.market_data?.total_volume?.usd,
        holders: data.community_data?.facebook_likes || '-',
        age: data.genesis_date,
        verified: true,
        description: data.description?.en,
        imageUrl: data.image?.large,
        links: [
          ...(data.links?.homepage?.[0] ? [{ label: 'Website', url: data.links.homepage[0], type: 'website' }] : []),
          ...(data.links?.twitter_screen_name ? [{ label: 'Twitter', url: `https://twitter.com/${data.links.twitter_screen_name}`, type: 'twitter' }] : []),
          ...(data.links?.subreddit ? [{ label: 'Reddit', url: `https://reddit.com${data.links.subreddit}`, type: 'reddit' }] : []),
        ],
        address: 'N/A',
        pairAddress: 'N/A',
        url: data.links?.blockchain_site?.[0] || '',
      };
    }, 3, 3000);
  } catch (err) {
    console.error('CoinGecko fetch error:', err);
    return null;
  }
}


// ========== User-editable fields (for strategies) ==========



/**
 * STRATEGY_FIELDS: Only user-editable filter fields (used for filtering tokens)
 * Users can only set these fields in their strategy.
 */
export type StrategyField = { key: string; label: string; type: string; optional: boolean; tokenField?: string };
export let STRATEGY_FIELDS: StrategyField[] = [
  { key: 'minMarketCap', label: 'Minimum Market Cap (USD)', type: 'number', optional: false, tokenField: 'marketCap' },
  { key: 'minLiquidity', label: 'Minimum Liquidity (USD)', type: 'number', optional: false, tokenField: 'liquidity' },
  { key: 'minVolume', label: 'Minimum Volume (24h USD)', type: 'number', optional: false, tokenField: 'volume' },
  { key: 'minAge', label: 'Minimum Age (minutes)', type: 'number', optional: false, tokenField: 'age' }
];


// ========== DexScreener API Integration ==========

/**
 * Fetch token profiles from DexScreener API.
 * @param chainId Optional chainId to filter (e.g., 'solana').
 * @param extraParams Optional object for more query params.
 * @returns Array of token profiles.
 *
 * If the API does not support filtering, filtering will be done locally.
 */
export async function fetchDexScreenerProfiles(chainId?: string, extraParams?: Record<string, string>): Promise<any[]> {
  let url = 'https://api.dexscreener.com/token-profiles/latest/v1';
  const params: Record<string, string> = {};
  if (chainId) params.chainId = chainId;
  if (extraParams) Object.assign(params, extraParams);
  const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  if (query) url += `?${query}`;
  try {
    const response = await axios.get(url);
    let data = Array.isArray(response.data) ? response.data : [];
    // If API does not support filtering, fallback to local filtering
    if (chainId && data.length && !data.some(t => t.chainId === chainId)) {
      data = data.filter((t: any) => t.chainId === chainId);
    }
    return data;
  } catch (err: any) {
    // Log more details
    const msg = err?.message || err?.toString() || 'Unknown error';
    const status = err?.response?.status;
    const urlInfo = url;
    console.error(`DexScreener token-profiles fetch error: ${msg} (status: ${status}) [${urlInfo}]`);
    // Optionally, throw or return a special error object
    throw new Error(`Failed to fetch token profiles from DexScreener: ${msg}`);
  }
}

export async function fetchDexScreenerPairsForSolanaTokens(tokenAddresses: string[]): Promise<any[]> {
  const chainId = 'solana';
  const allPairs: any[] = [];
  for (const tokenAddress of tokenAddresses) {
    const url = `https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`;
    try {
      const response = await axios.get(url);
      if (Array.isArray(response.data)) {
        allPairs.push(...response.data);
      }
    } catch (err) {
      // Ignore individual errors
    }
  }
  return allPairs;
}

/**
 * Fetch Solana tokens (or any chain) from DexScreener with optional params.
 * @param chainId Chain to fetch (default: 'solana')
 * @param extraParams Optional query params (e.g. { limit: '100' })
 */
export async function fetchDexScreenerTokens(chainId: string = 'solana', extraParams?: Record<string, string>): Promise<any[]> {
  // 1. Fetch tokens from token-profiles with filtering at API level
  const profiles = await fetchDexScreenerProfiles(chainId, extraParams ?? { limit: '100' });
  // 2. Fetch pairs (market data) for each token
  const tokenAddresses = profiles.map((t: any) => t.tokenAddress).filter(Boolean);
  const pairs = await fetchDexScreenerPairsForSolanaTokens(tokenAddresses);

  // 3. Merge data: for each token, merge profile with pairs (market data)
  const allTokens: Record<string, any> = {};
  for (const profile of profiles) {
    const addr = profile.tokenAddress;
    if (!addr) continue;
    allTokens[addr] = { ...profile };
  }
  // Add pairs (market data)
  for (const pair of pairs) {
    // Each pair has baseToken.address
    const addr = getField(pair, 'baseToken.address', 'tokenAddress', 'address', 'mint', 'pairAddress');
    if (!addr) continue;
    if (!allTokens[addr]) allTokens[addr] = {};
    // Merge pair data with token
    for (const key of Object.keys(FIELD_MAP)) {
      if (allTokens[addr][key] === undefined || EMPTY_VALUES.includes(allTokens[addr][key])) {
        const val = getField(pair, key);
        if (!EMPTY_VALUES.includes(val)) allTokens[addr][key] = val;
      }
    }
    // Get some fields from baseToken if missing
    if (pair.baseToken && typeof pair.baseToken === 'object') {
      for (const key of Object.keys(FIELD_MAP)) {
        if (allTokens[addr][key] === undefined || EMPTY_VALUES.includes(allTokens[addr][key])) {
          const val = getField(pair.baseToken, key);
          if (!EMPTY_VALUES.includes(val)) allTokens[addr][key] = val;
        }
      }
    }
    // liquidity: may be in pair.liquidity.usd or pair.liquidity
    if ((allTokens[addr].liquidity === undefined || EMPTY_VALUES.includes(allTokens[addr].liquidity)) && pair.liquidity) {
      if (typeof pair.liquidity === 'object' && typeof pair.liquidity.usd === 'number') allTokens[addr].liquidity = pair.liquidity.usd;
      else if (typeof pair.liquidity === 'number') allTokens[addr].liquidity = pair.liquidity;
    }
    // priceUsd
    if ((allTokens[addr].priceUsd === undefined || EMPTY_VALUES.includes(allTokens[addr].priceUsd)) && pair.priceUsd) {
      allTokens[addr].priceUsd = pair.priceUsd;
    }
    // marketCap
    if ((allTokens[addr].marketCap === undefined || EMPTY_VALUES.includes(allTokens[addr].marketCap)) && pair.fdv) {
      allTokens[addr].marketCap = pair.fdv;
    }
    if ((allTokens[addr].marketCap === undefined || EMPTY_VALUES.includes(allTokens[addr].marketCap)) && pair.marketCap) {
      allTokens[addr].marketCap = pair.marketCap;
    }

    // ====== استخراج الحقول الزمنية ======
    // الأولوية: pair.pairCreatedAt > pair.createdAt > pair.baseToken.createdAt > profile.createdAt > profile.genesis_date
    let createdTs =
      pair.pairCreatedAt ||
      pair.createdAt ||
      (pair.baseToken && pair.baseToken.createdAt) ||
      (allTokens[addr].createdAt) ||
      (allTokens[addr].genesis_date);

    // إذا كان نص تاريخ، حوّله إلى timestamp
    if (typeof createdTs === 'string' && !isNaN(Date.parse(createdTs))) {
      createdTs = Date.parse(createdTs);
    }
    // إذا كان بالثواني وليس ملي ثانية
    if (typeof createdTs === 'number' && createdTs < 1e12 && createdTs > 1e9) {
      createdTs = createdTs * 1000;
    }
    // إذا كان بالسنوات (مثلاً genesis_date)
    if (typeof createdTs === 'string' && /^\d{4}-\d{2}-\d{2}/.test(createdTs)) {
      createdTs = Date.parse(createdTs);
    }
    // حساب العمر بالدقائق
    let ageMinutes = undefined;
    if (typeof createdTs === 'number' && createdTs > 0) {
      ageMinutes = Math.floor((Date.now() - createdTs) / 60000);
    }
    allTokens[addr].pairCreatedAt = pair.pairCreatedAt || null;
    allTokens[addr].poolOpenTime = createdTs || null;
    allTokens[addr].ageMinutes = ageMinutes;
  }

  // --- Normalization pass: ensure each token has a stable address/name and a numeric ageMinutes (in minutes)
  for (const addr of Object.keys(allTokens)) {
    const t = allTokens[addr];
    // Ensure canonical address field exists
    if (!t.address) t.address = addr;
    if (!t.tokenAddress) t.tokenAddress = addr;
    if (!t.pairAddress) t.pairAddress = t.pairAddress || addr;

    // Ensure name/symbol fallbacks
    if (!t.name) t.name = (t.baseToken && t.baseToken.name) || t.tokenName || t.title || '';
    if (!t.symbol) t.symbol = (t.baseToken && t.baseToken.symbol) || t.ticker || '';

    // Normalize poolOpenTime to a millisecond timestamp when possible
    let ct = t.poolOpenTime || t.createdAt || t.genesis_date || t.pairCreatedAt || null;
    if (typeof ct === 'string' && /^\n+\d{4}-\d{2}-\d{2}/.test(ct)) {
      ct = Date.parse(ct);
    }
    if (typeof ct === 'number' && ct > 0 && ct < 1e12 && ct > 1e9) {
      // seconds -> ms
      ct = ct * 1000;
    }
    // If ct now looks like ms timestamp, compute minutes and seconds
    if (typeof ct === 'number' && ct > 1e12) {
      t.poolOpenTime = ct;
      t.ageMinutes = Math.floor((Date.now() - ct) / 60000);
      t.ageSeconds = Math.floor((Date.now() - ct) / 1000);
    } else if (typeof t.ageMinutes === 'number' && !isNaN(t.ageMinutes)) {
      // already set (assume minutes) -> normalize and provide seconds
      t.ageMinutes = Math.floor(t.ageMinutes);
      t.ageSeconds = Math.floor(t.ageMinutes * 60);
    } else {
      // give a safe undefined rather than various formats
      t.ageMinutes = undefined;
      t.ageSeconds = undefined;
    }
  }

  // 4. If not enough data, use CoinGecko fallback (same logic as before)
  let cgTokens: any[] = [];
  let coinGeckoFailed = false;
  if (Object.keys(allTokens).length === 0) {
    try {
      const solanaToken = await fetchSolanaFromCoinGecko();
      if (solanaToken) cgTokens.push(solanaToken);
      const listUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
      const listResponse = await retryAsync(() => axios.get(listUrl), 3, 3000);
      const allTokensList = listResponse.data;
      const solanaTokens = allTokensList.filter((t: any) => t.platforms && t.platforms.solana);
      const limited = solanaTokens.slice(0, 10);
      const details = await Promise.all(limited.map(async (t: any) => {
        try {
          const url = `https://api.coingecko.com/api/v3/coins/${t.id}`;
          const response = await retryAsync(() => axios.get(url), 3, 3000);
          const data = response.data;
          return {
            name: data.name,
            symbol: data.symbol,
            priceUsd: data.market_data?.current_price?.usd,
            marketCap: data.market_data?.market_cap?.usd,
            volume: data.market_data?.total_volume?.usd,
            holders: data.community_data?.facebook_likes || '-',
            age: data.genesis_date,
            verified: true,
            description: data.description?.en,
            imageUrl: data.image?.large,
            links: [
              ...(data.links?.homepage?.[0] ? [{ label: 'Website', url: data.links.homepage[0], type: 'website' }] : []),
              ...(data.links?.twitter_screen_name ? [{ label: 'Twitter', url: `https://twitter.com/${data.links.twitter_screen_name}`, type: 'twitter' }] : []),
              ...(data.links?.subreddit ? [{ label: 'Reddit', url: `https://reddit.com${data.links.subreddit}`, type: 'reddit' }] : []),
            ],
            address: t.platforms.solana,
            pairAddress: t.platforms.solana,
            url: data.links?.blockchain_site?.[0] || '',
            // الحقول الزمنية من CoinGecko
            poolOpenTime: data.genesis_date ? Date.parse(data.genesis_date) : null,
            ageMinutes: data.genesis_date ? Math.floor((Date.now() - Date.parse(data.genesis_date)) / 60000) : null,
          };
        } catch (err) {
          return null;
        }
      }));
      cgTokens = cgTokens.concat(details.filter(Boolean));
    } catch (err) {
      coinGeckoFailed = true;
      console.error('CoinGecko Solana tokens fetch error:', err);
    }
    if (coinGeckoFailed || cgTokens.length === 0) {
      console.warn('CoinGecko unavailable, no tokens fetched.');
      cgTokens = [];
    }
    // Add them to allTokens
    for (const t of cgTokens) {
      const addr = t.address || t.tokenAddress || t.mint || t.pairAddress;
      if (!addr) continue;
      allTokens[addr] = { ...t };
    }
  }
  // Ensure each token has poolOpenTimeMs and ageSeconds where possible
  for (const addr of Object.keys(allTokens)) {
    const t = allTokens[addr];
    // ensure poolOpenTimeMs if we have poolOpenTime
    if (t.poolOpenTime && typeof t.poolOpenTime === 'number') {
      // convert seconds -> ms if needed
      let ct = t.poolOpenTime;
      if (ct > 0 && ct < 1e12 && ct > 1e9) ct = ct * 1000;
      t.poolOpenTimeMs = ct;
      if (typeof ct === 'number' && ct > 0) {
        t.ageSeconds = Math.floor((Date.now() - ct) / 1000);
        t.ageMinutes = Math.floor((Date.now() - ct) / 60000);
      }
    }
    if (t.ageMinutes === undefined && typeof t.ageSeconds === 'number') {
      t.ageMinutes = Math.floor((t.ageSeconds || 0) / 60);
    }
  }
  return Object.values(allTokens);
}


// ===== Enrichment helpers (Helius primary, RPC fallback) =====
const heliusTimestampCache: Record<string, { ts: number | null; fetchedAt: number }> = {};
// Per-host state to avoid tight retry loops when a provider starts returning 429s
const heliusHostState: Record<string, { failureCount: number; cooldownUntil: number }> = {};
const enrichmentMetrics: {
  heliusCalls: number; heliusFailures: number; heliusTotalMs: number;
  rpcCalls: number; rpcFailures: number; rpcTotalMs: number;
  solscanCalls: number; solscanFailures: number; solscanTotalMs: number;
} = {
  heliusCalls: 0, heliusFailures: 0, heliusTotalMs: 0,
  rpcCalls: 0, rpcFailures: 0, rpcTotalMs: 0,
  solscanCalls: 0, solscanFailures: 0, solscanTotalMs: 0
};

async function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function getFirstTxTimestampFromRpc(address: string): Promise<number | null> {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.MAINNET_RPC;
    if (!rpcUrl) return null;
    const conn = new Connection(rpcUrl, { commitment: 'confirmed' } as any);
    const pub = new PublicKey(address);
    const start = Date.now();
    enrichmentMetrics.rpcCalls++;
    // fetch signatures (most recent first) — we will pick the oldest found in this batch
    const sigs = await conn.getSignaturesForAddress(pub, { limit: 50 });
    if (!sigs || sigs.length === 0) {
      enrichmentMetrics.rpcTotalMs += (Date.now() - start);
      return null;
    }
    // check transactions for blockTime; try to find earliest blockTime
    let earliestMs: number | null = null;
    for (const s of sigs) {
      try {
        const tx = await conn.getTransaction(s.signature, { commitment: 'confirmed' } as any);
        const bt = tx?.blockTime;
        if (bt) {
          const ms = (bt > 1e9 && bt < 1e12) ? bt * 1000 : (bt > 1e12 ? bt : bt * 1000);
          if (!earliestMs || ms < earliestMs) earliestMs = ms;
        }
      } catch (e) {
        // ignore individual tx failures
      }
    }
    enrichmentMetrics.rpcTotalMs += (Date.now() - start);
    return earliestMs;
  } catch (e) {
    enrichmentMetrics.rpcFailures++;
    return null;
  }
}

async function getFirstTxTimestampFromHelius(address: string): Promise<number | null> {
  // Prefer Helius RPC (if provided) which is typically higher-rate for paid keys.
  const heliusRpc = process.env.HELIUS_RPC_URL || process.env.MAINNET_RPC;
  const apiUrlTemplate = process.env.HELIUS_PARSE_HISTORY_URL || process.env.HELIUS_PARSE_TX_URL;
  // cache check
  const cached = heliusTimestampCache[address];
  const ttl = Number(process.env.HELIUS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
  if (cached && (Date.now() - cached.fetchedAt) < ttl) return cached.ts;

  // Helper: HTTP GET with retry/backoff honoring Retry-After
  async function heliusHttpGetWithRetries(url: string, maxAttempts = Number(process.env.HELIUS_RETRY_MAX_ATTEMPTS || 1)) {
    const axios = (await import('axios')).default;
    let lastErr: any = null;
    const baseMs = Number(process.env.HELIUS_RETRY_BASE_MS || 500);
    const jitterMs = Number(process.env.HELIUS_RETRY_JITTER_MS || 300);
    // derive host key for simple circuit breaker / cooldown
    let hostKey: string | null = null;
    try { hostKey = new URL(url).host; } catch (e) { hostKey = null; }
    if (hostKey) {
      const state = heliusHostState[hostKey];
      if (state && state.cooldownUntil && Date.now() < state.cooldownUntil) {
        // Fail fast silently (no repeated logs)
        const err: any = new Error(`Host ${hostKey} in cooldown`);
        err.code = 'HELIUS_HOST_COOLDOWN';
        throw err;
      }
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const start = Date.now();
      try {
        enrichmentMetrics.heliusCalls++;
        const headers: Record<string,string> = { 'Accept': 'application/json' };
        if (process.env.HELIUS_API_KEY) headers['x-api-key'] = process.env.HELIUS_API_KEY;
        const r = await axios.get(url, { timeout: 20000, headers });
        enrichmentMetrics.heliusTotalMs += (Date.now() - start);
        // on success, reset host failure count
        if (hostKey && heliusHostState[hostKey]) {
          heliusHostState[hostKey].failureCount = 0;
          heliusHostState[hostKey].cooldownUntil = 0;
        }
        return r;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        if (!status || status >= 500 || status === 429) enrichmentMetrics.heliusFailures++;
        const retryAfter = err?.response?.headers?.['retry-after'];
        // If non-retryable client error (4xx other than 429), bail
        if (status && status >= 400 && status < 500 && status !== 429) break;
        // If host is returning 429s, increment failure counter and set longer cooldown
        if (status === 429 && hostKey) {
          const state = heliusHostState[hostKey] || { failureCount: 0, cooldownUntil: 0 };
          state.failureCount = (state.failureCount || 0) + 1;
          // exponential cooldown (cap at 5 minutes) + jitter
          const cooldown = Math.min(baseMs * Math.pow(2, state.failureCount), 5 * 60 * 1000) + Math.floor(Math.random() * jitterMs);
          state.cooldownUntil = Date.now() + cooldown;
          heliusHostState[hostKey] = state;
          // Wait a short time before next attempt but avoid tight loops
          const wait = Math.min(cooldown, 15000);
          await sleep(wait);
          // Minimal, single-line notification when entering cooldown; avoid printing every retry or stack
          if (state.failureCount === 1) {
            console.warn(`[Helius] ${hostKey} responded 429 — entering cooldown ~${Math.round(cooldown/1000)}s`);
          } else if (state.failureCount > 1 && state.failureCount % 5 === 0) {
            // occasional periodic notice every N repeated failures to aid ops without flooding logs
            console.warn(`[Helius] ${hostKey} still returning 429s (failures=${state.failureCount})`);
          }
          continue;
        }
        // If server provided Retry-After, honor it
        if (retryAfter) {
          const ra = Number(retryAfter);
          if (!isNaN(ra) && ra > 0) {
            await sleep(ra * 1000);
            continue;
          }
        }
        // Default exponential backoff with jitter
        if (attempt < maxAttempts) {
          let wait = Math.min(baseMs * Math.pow(2, attempt - 1), 30000);
          wait += Math.floor(Math.random() * jitterMs);
          await sleep(wait);
          continue;
        }
        break;
      }
    }
    // Final: emit a concise single-line error (no stack) and throw
    try {
      const status = lastErr?.response?.status;
      const host = hostKey || 'unknown-host';
      console.error(`[Helius] HTTP failure for ${host} after retries (status=${status}): ${String(lastErr?.message || lastErr)}`);
    } catch (e) {
      console.error('[Helius] HTTP failure after retries');
    }
    throw lastErr;
  }

  try {
    // 1) Try Helius RPC endpoint via solana web3 (best for paid keys)
    if (heliusRpc) {
      try {
        const { Connection, PublicKey } = await import('@solana/web3.js');
        const conn = new Connection(heliusRpc, { commitment: 'confirmed' } as any);
        const pub = new PublicKey(address);
        const start = Date.now();
        enrichmentMetrics.heliusCalls++;
  const sigLimit = Number(process.env.HELIUS_SIG_LIMIT || 20);
  const sigs = await conn.getSignaturesForAddress(pub, { limit: sigLimit });
        if (sigs && sigs.length > 0) {
          let earliestMs: number | null = null;
          // fetch transactions in parallel but with small concurrency to avoid throttling
          const concurrency = Number(process.env.HELIUS_RPC_CONCURRENCY || 2);
          for (let i = 0; i < sigs.length; i += concurrency) {
            const slice = sigs.slice(i, i + concurrency);
            const txs = await Promise.all(slice.map(s => conn.getTransaction(s.signature, { commitment: 'confirmed' } as any).catch(() => null)));
            for (const tx of txs) {
              const bt = tx?.blockTime;
              if (!bt) continue;
              const ms = (bt > 1e9 && bt < 1e12) ? bt * 1000 : (bt > 1e12 ? bt : bt * 1000);
              if (!earliestMs || ms < earliestMs) earliestMs = ms;
            }
            // small delay to avoid bursts
            await sleep(50);
          }
          enrichmentMetrics.heliusTotalMs += (Date.now() - start);
          heliusTimestampCache[address] = { ts: earliestMs, fetchedAt: Date.now() };
          return earliestMs;
        }
      } catch (err) {
        // if RPC attempt fails, continue to parse API below
      }
    }

    // 2) Fall back to Helius parse/history HTTP endpoints (if configured)
    if (apiUrlTemplate) {
      const url = (apiUrlTemplate.indexOf('{address}') !== -1) ? apiUrlTemplate.replace('{address}', address) : apiUrlTemplate + '&mint=' + address;
      const r = await heliusHttpGetWithRetries(url);
      const items: any[] = Array.isArray(r.data) ? r.data : (r.data?.transactions || []);
      if (!items || items.length === 0) {
        heliusTimestampCache[address] = { ts: null, fetchedAt: Date.now() };
        return null;
      }
      let earliest = Number.MAX_SAFE_INTEGER;
      for (const it of items) {
        const bt = it.blockTime || it.timestamp || (it.slot ? undefined : undefined);
        if (!bt) continue;
        if (bt > 1e9 && bt < 1e12) earliest = Math.min(earliest, bt * 1000);
        else if (bt > 1e12) earliest = Math.min(earliest, bt);
        else if (bt < 1e9) earliest = Math.min(earliest, bt * 1000);
      }
      const resultMs = (earliest === Number.MAX_SAFE_INTEGER) ? null : earliest;
      heliusTimestampCache[address] = { ts: resultMs, fetchedAt: Date.now() };
      return resultMs;
    }

    // 3) If nothing configured, return null
    return null;
  } catch (e) {
    // If HTTP / RPC failed: try Solscan then RPC fallback if enabled
    enrichmentMetrics.heliusFailures++;
    if ((process.env.SOLSCAN_FALLBACK_ENABLED || 'true') === 'true') {
      try {
        const ts = await getFirstTxTimestampFromSolscan(address);
        if (ts) return ts;
      } catch (err) {
        // ignore
      }
    }
    if ((process.env.HELIUS_FALLBACK_ENABLED || 'true') === 'true') {
      const fallback = await getFirstTxTimestampFromRpc(address);
      return fallback;
    }
    return null;
  }
}

async function getFirstTxTimestampFromSolscan(address: string): Promise<number | null> {
  try {
    const base = process.env.SOLSCAN_API_URL;
    if (!base) return null;
    const url = `${base.replace(/\/+$/,'')}/account/transactions?address=${encodeURIComponent(address)}&limit=50`;
    const axios = (await import('axios')).default;
    const start = Date.now();
    enrichmentMetrics.solscanCalls++;
    const r = await axios.get(url, { timeout: 8000 });
    enrichmentMetrics.solscanTotalMs += (Date.now() - start);
    const items: any[] = Array.isArray(r.data) ? r.data : (r.data?.data || []);
    if (!items || items.length === 0) {
      enrichmentMetrics.solscanFailures++;
      return null;
    }
    let earliest = Number.MAX_SAFE_INTEGER;
    for (const it of items) {
      const bt = it.blockTime || it.block_time || it.timestamp || it.time;
      if (!bt) continue;
      if (bt > 1e9 && bt < 1e12) earliest = Math.min(earliest, bt * 1000);
      else if (bt > 1e12) earliest = Math.min(earliest, bt);
      else if (bt < 1e9) earliest = Math.min(earliest, bt * 1000);
    }
    const resultMs = (earliest === Number.MAX_SAFE_INTEGER) ? null : earliest;
    return resultMs;
  } catch (e) {
    enrichmentMetrics.solscanFailures++;
    return null;
  }
}

// ----- On-chain activity quick checks -----
export async function checkOnChainActivity(address: string): Promise<{ firstTxMs: number | null; found: boolean }> {
  if (!address) return { firstTxMs: null, found: false };
  try {
    // Prefer Helius / RPC path since they tend to return parsed transactions or block times
    let ts: number | null = null;
    try {
      ts = await getFirstTxTimestampFromHelius(address);
    } catch (e) {
      ts = null;
    }
    if (!ts) {
      try {
        ts = await getFirstTxTimestampFromSolscan(address);
      } catch (e) {
        ts = null;
      }
    }
    if (!ts) {
      try {
        ts = await getFirstTxTimestampFromRpc(address);
      } catch (e) {
        ts = null;
      }
    }
    return { firstTxMs: ts, found: !!ts };
  } catch (err) {
    return { firstTxMs: null, found: false };
  }
}

/**
 * computeFreshnessScore: lightweight multi-source corroboration score (0-100).
 * Uses DexScreener / pair timestamps (token.poolOpenTimeMs, pairCreatedAt),
 * on-chain first-tx timestamps, and simple liquidity/volume heuristics.
 * Attaches token.freshnessScore and token.freshnessDetails for downstream use.
 */
export async function computeFreshnessScore(token: any): Promise<{ score: number; details: any }> {
  const addr = token?.tokenAddress || token?.address || token?.mint || token?.pairAddress;
  const now = Date.now();
  // Candidate timestamps
  const dsTs = token?.poolOpenTimeMs || token?.pairCreatedAt || token?.pairCreatedAtMs || null;
  let dsTsMs: number | null = null;
  if (typeof dsTs === 'number') {
    dsTsMs = dsTs;
    // normalize seconds -> ms if necessary
    if (dsTsMs && dsTsMs < 1e12 && dsTsMs > 1e9) dsTsMs = Math.floor(dsTsMs * 1000);
  }

  let onChainTs: number | null = null;
  // Allow env toggle to opt-out of extra on-chain calls
  const enableOnchain = (process.env.ENABLE_ONCHAIN_FRESHNESS || 'true') === 'true';
  if (enableOnchain && addr) {
    try {
      // Keep on-chain check short to avoid long blocking; use withTimeout utility
      const res = await withTimeout(checkOnChainActivity(addr), Number(process.env.ONCHAIN_FRESHNESS_TIMEOUT_MS || 3000), 'onchain-freshness');
      onChainTs = res.firstTxMs || null;
    } catch (e) {
      onChainTs = null;
    }
  }

  // Base scoring
  let score = 0;
  const details: any = { dsTs: dsTsMs, onChainTs };

  if (dsTsMs && onChainTs) {
    const delta = Math.abs(dsTsMs - onChainTs);
    // close agreement => high score
    if (delta <= 5 * 60 * 1000) score += 60, details.corroboration = 'very_close';
    else if (delta <= 60 * 60 * 1000) score += 45, details.corroboration = 'close';
    else if (delta <= 24 * 60 * 60 * 1000) score += 30, details.corroboration = 'same_day';
    else score += 15, details.corroboration = 'different_days';
  } else if (onChainTs) {
    score += 40; details.corroboration = 'onchain_only';
  } else if (dsTsMs) {
    score += 30; details.corroboration = 'dex_only';
  } else {
    score += 10; details.corroboration = 'no_timestamps';
  }

  // Liquidity / volume boosts (small boosts)
  const liquidity = extractNumeric(getField(token, 'liquidity')) || 0;
  const volume = extractNumeric(getField(token, 'volume')) || 0;
  if (liquidity >= 1000) score += 10;
  if (volume >= 100) score += 10;

  // Penalize extremely old tokens (unless user explicitly allows old tokens)
  const ageMinutes = typeof token.ageMinutes === 'number' ? token.ageMinutes : undefined;
  if (typeof ageMinutes === 'number' && ageMinutes > Number(process.env.FRESHNESS_MAX_AGE_MINUTES || 60 * 24 * 7)) {
    // older than default 1 week => low score
    score = Math.min(score, 20);
    details.agePenalty = true;
  }

  // Normalize to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));
  // Attach to token for downstream decision making
  try {
    token.freshnessScore = score;
    token.freshnessDetails = details;
  } catch (e) { /* ignore */ }
  return { score, details };
}


export async function enrichTokenTimestamps(tokens: any[], opts?: { batchSize?: number; delayMs?: number }) {
  const batchSize = opts?.batchSize ?? Number(process.env.HELIUS_BATCH_SIZE || 4);
  const delayMs = opts?.delayMs ?? Number(process.env.HELIUS_BATCH_DELAY_MS || 400);
  const enrichLimit = Number(process.env.HELIUS_ENRICH_LIMIT || 8);
  // Build canonical address -> token map
  const addrMap = new Map<string, any>();
  for (const t of tokens) {
    const key = t.tokenAddress || t.address || t.mint || t.pairAddress;
    if (key) addrMap.set(key, t);
  }
  // Rank candidates by liquidity then volume (desc)
  const candidates = Array.from(addrMap.entries()).map(([addr, t]) => ({ addr, token: t, score: (Number(t.liquidity || 0) + Number(t.volume || 0)) }));
  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  const toEnrich = candidates.slice(0, Math.min(enrichLimit, candidates.length)).map(c => c.addr);
  // Summary counters
  let enrichedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  // Enrich in small batches to avoid bursts
  for (let i = 0; i < toEnrich.length; i += batchSize) {
    const batch = toEnrich.slice(i, i + batchSize);
    const results: Array<number | null> = [];
    for (const addr of batch) {
      try {
        // Prefer Solscan (lower rate) first if configured
        let ts = null as number | null;
        if ((process.env.SOLSCAN_FALLBACK_ENABLED || 'true') === 'true' && process.env.SOLSCAN_API_URL) {
          try { ts = await getFirstTxTimestampFromSolscan(addr); } catch (e) { ts = null; }
        }
        // If Solscan didn't return, try Helius (RPC/parse)
        if (!ts) {
          try { ts = await getFirstTxTimestampFromHelius(addr); } catch (e) { ts = null; }
        }
        // Last-resort RPC fallback
        if (!ts && (process.env.HELIUS_FALLBACK_ENABLED || 'true') === 'true') {
          try { ts = await getFirstTxTimestampFromRpc(addr); } catch (e) { ts = null; }
        }
        results.push(ts);
      } catch (e) {
        errorCount++;
        results.push(null);
      }
    }
    // Apply results to tokens
    for (let j = 0; j < batch.length; j++) {
      const addr = batch[j];
      const tsMs = results[j];
      const token = addrMap.get(addr);
      if (!token) { skippedCount++; continue; }
      if (tsMs) {
        token.poolOpenTimeMs = tsMs;
        token.ageSeconds = Math.floor((Date.now() - tsMs) / 1000);
        token.ageMinutes = Math.floor(token.ageSeconds / 60);
        enrichedCount++;
      } else {
        skippedCount++;
      }
        // Compute a lightweight freshness score for downstream filters/notifications
        try {
          // fire-and-wait with a short timeout to avoid blocking the batch too long
          const scoreRes = await withTimeout(computeFreshnessScore(token), Number(process.env.FRESHNESS_SCORE_TIMEOUT_MS || 2000), 'freshness-score');
          // token.freshnessScore and token.freshnessDetails are set by computeFreshnessScore
        } catch (e) {
          // If scoring fails, continue silently; don't block notifications
        }
    }
    if (i + batchSize < toEnrich.length) await sleep(delayMs);
  }
  // Final concise log
  // Avoid printing repetitive messages; print a single-line summary
  console.log(`Enrichment summary: attempted=${toEnrich.length} enriched=${enrichedCount} skipped=${skippedCount} errors=${errorCount}`);
}

export function getEnrichmentMetrics() {
  return { ...enrichmentMetrics };
}

// ========== Formatting and display functions ==========
export function fmt(val: number | string | undefined | null, digits?: number, unit?: string): string {
  if (val === undefined || val === null) return '-';
  let num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return String(val);
  let usedDigits = digits !== undefined ? digits : (Math.abs(num) < 1 ? 6 : 2);
  let str = num.toLocaleString(undefined, { maximumFractionDigits: usedDigits });
  if (unit) str += ' ' + unit;
  return str;
}



// --- Helper functions for building the message ---

function buildInlineKeyboard(token: any, botUsername: string, pairAddress: string, userId?: string) {
  const dexUrl = token.url || (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : '');
  const twitterEmoji = '🐦', dexEmoji = '🧪', shareEmoji = '📤';
  const inlineKeyboard: any[][] = [];
  // Row 1: Twitter, DexScreener (only if available)
  const row1: any[] = [];
  if (Array.isArray(token.links)) {
    for (const l of token.links) {
      if (l.type === 'twitter' && l.url) row1.push({ text: `${twitterEmoji} Twitter`, url: l.url });
    }
  }
  if (dexUrl) row1.push({ text: `${dexEmoji} DexScreener`, url: dexUrl });
  if (row1.length) inlineKeyboard.push(row1);
  // Row 2: Share button (external share link)
  let shareId = userId || token._userId || (token.tokenAddress || token.address || token.mint || token.pairAddress || '');
  // External share link (Telegram deep link with share parameter)
  const shareUrl = `https://t.me/share/url?url=https://t.me/${botUsername}?start=${shareId}`;
  const row2: any[] = [ { text: `${shareEmoji} Share`, url: shareUrl } ];
  inlineKeyboard.push(row2);
  return { inlineKeyboard };
}

// --- Helper functions for building the message ---
function getTokenCoreFields(token: any) {
  return {
    name: token.name || token.baseToken?.name || '',
    symbol: token.symbol || token.baseToken?.symbol || '',
    address: token.tokenAddress || token.address || token.mint || token.pairAddress || token.url?.split('/').pop() || '',
    dexUrl: token.url || (token.pairAddress ? `https://dexscreener.com/solana/${token.pairAddress}` : ''),
    logo: token.imageUrl || token.logoURI || token.logo || token.baseToken?.logoURI || ''
  };
}

function getTokenStats(token: any) {
  const price = extractNumeric(getField(token, 'priceUsd', 'price', 'baseToken.priceUsd', 'baseToken.price'), 0);
  const marketCap = extractNumeric(getField(token, 'marketCap'));
  const liquidity = extractNumeric(getField(token, 'liquidity'));
  const volume = extractNumeric(getField(token, 'volume'));
  const holders = extractNumeric(getField(token, 'holders'));
  let age = getField(token, 'age', 'createdAt');
  // حذف سطر الهولدرز نهائياً
  let ageDisplay: string = 'Not available';
  let ageMs: number | undefined = undefined;
  if (typeof age === 'string') age = Number(age);
  if (typeof age === 'number' && !isNaN(age)) {
    if (age > 1e12) ageMs = Date.now() - age; // ms timestamp
    else if (age > 1e9) ageMs = Date.now() - age * 1000; // s timestamp
    else if (age < 1e7 && age > 0) ageMs = age * 60 * 1000; // minutes
  }
  if (typeof ageMs === 'number' && !isNaN(ageMs) && ageMs > 0) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((ageMs % (60 * 1000)) / 1000);
    if (days > 0) {
      ageDisplay = `${days} day${days > 1 ? 's' : ''}`;
      if (hours > 0) ageDisplay += ` ${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      ageDisplay = `${hours} hour${hours > 1 ? 's' : ''}`;
      if (minutes > 0) ageDisplay += ` ${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      ageDisplay = `${minutes} minute${minutes > 1 ? 's' : ''}`;
      if (seconds > 0) ageDisplay += ` ${seconds} second${seconds > 1 ? 's' : ''}`;
    } else {
      ageDisplay = `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
  }
  return { price, marketCap, liquidity, volume, holders, ageDisplay };
}

function getTokenBuySell(token: any) {
  const buyVol = extractNumeric(token.buyVolume || token.buy_volume || token.volumeBuy || token.volume_buy);
  const sellVol = extractNumeric(token.sellVolume || token.sell_volume || token.volumeSell || token.volume_sell);
  return { buyVol, sellVol };
}

function buildExtraFields(token: any) {
  // Add unimportant fields to the skip list
  const skipFields = new Set([
    'name','baseToken','tokenAddress','address','mint','pairAddress','url','imageUrl','logoURI','logo','links','description','symbol','priceUsd','price','marketCap','liquidity','volume','holders','age','genesis_date','pairCreatedAt',
    'icon','header','openGraph' // unimportant fields
  ]);
  let msg = '';
  for (const key of Object.keys(token)) {
    if (skipFields.has(key)) continue;
    let value = token[key];
    if (value === undefined || value === null || value === '' || value === '-' || value === 'N/A' || value === 'null' || value === 'undefined') continue;
    if (typeof value === 'number') {
      msg += `<b>${key}:</b> ${fmt(value, 6)}\n`;
    } else if (typeof value === 'string') {
      // Don't show any image links or pictures
      if (/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)$/i.test(value)) {
        continue;
      } else if (/^https?:\/.*/.test(value)) {
        // If it's a link, show it as a link with an emoji only
        msg += `<b>${key}:</b> <a href='${value}'>🔗</a>\n`;
      } else {
        msg += `<b>${key}:</b> ${value}\n`;
      }
    } else if (typeof value === 'boolean') {
      msg += `<b>${key}:</b> ${value ? '✅' : '❌'}\n`;
    } else if (typeof value === 'object') {
      const numVal = extractNumeric(value);
      if (numVal !== undefined) {
        msg += `<b>${key}:</b> ${fmt(numVal, 6)}\n`;
      } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
        msg += `<b>${key}:</b> ${value.join(', ')}\n`;
      }
    }
  }
  return msg;
}

export function buildTokenMessage(token: any, botUsername: string, pairAddress: string, userId?: string): { msg: string, inlineKeyboard: any[][] } {
  const { name, symbol, address, dexUrl, logo } = getTokenCoreFields(token);
  const { price, marketCap, liquidity, volume, holders, ageDisplay } = getTokenStats(token);
  const { buyVol, sellVol } = getTokenBuySell(token);
  // --- Emojis ---
  const solEmoji = '🟣', memecoinEmoji = '🚀', chartEmoji = '📈', capEmoji = '💰', liqEmoji = '💧', volEmoji = '🔊', holdersEmoji = '👥', ageEmoji = '⏱️', linkEmoji = '🔗';
  // --- Message header ---
  let msg = '';
  // Show token name and symbol clearly
  msg += `🪙${solEmoji} <b>${name ? name : 'Not available'}</b>${symbol ? ' <code>' + symbol + '</code>' : ''}\n`;
  msg += `${linkEmoji} <b>Address:</b> <code>${address ? address : 'Not available'}</code>\n`;
  // --- Stats ---
  msg += `${capEmoji} <b>Market Cap:</b> ${fmtField(marketCap, 'marketCap')} USD\n`;
  msg += `${liqEmoji} <b>Liquidity:</b> ${fmtField(liquidity, 'liquidity')} USD  `;
  if (typeof liquidity === 'number' && !isNaN(liquidity) && typeof marketCap === 'number' && marketCap > 0) {
    const liqPct = Math.min(100, Math.round((liquidity / marketCap) * 100));
    msg += progressBar(liqPct, 10, '🟦', '⬜') + ` ${liqPct}%\n`;
  } else {
    msg += '\n';
  }
  msg += `${volEmoji} <b>Volume 24h:</b> ${fmtField(volume, 'volume')} USD  `;
  if (typeof volume === 'number' && !isNaN(volume) && typeof marketCap === 'number' && marketCap > 0) {
    const volPct = Math.min(100, Math.round((volume / marketCap) * 100));
    msg += progressBar(volPct, 10, '🟩', '⬜') + ` ${volPct}%\n`;
  } else {
    msg += '\n';
  }
  msg += `${ageEmoji} <b>Age:</b> ${ageDisplay}\n`;
  msg += `${chartEmoji} <b>Price:</b> ${fmtField(price, 'price')} USD\n`;
  // --- Buy/Sell progress bar ---
  if (buyVol !== undefined || sellVol !== undefined) {
    const totalVol = (buyVol || 0) + (sellVol || 0);
    if (totalVol > 0) {
      const buyPct = Math.round((buyVol || 0) / totalVol * 100);
      const sellPct = 100 - buyPct;
      msg += `🟢 Buy:  ${progressBar(buyPct, 10, '🟩', '⬜')} ${buyPct}%\n`;
      msg += `🔴 Sell: ${progressBar(sellPct, 10, '🟥', '⬜')} ${sellPct}%\n`;
    }
  }
  // --- Extra fields ---
  msg += buildExtraFields(token);
  // --- Description ---
  if (token.description) msg += `\n<em>${token.description}</em>\n`;
  // --- Network line ---
  if (token.chainId || token.chain || token.chainName) {
    const network = token.chainId || token.chain || token.chainName;
    msg += `🌐 <b>Network:</b> ${network}\n`;
  }
  // --- Only add community/footer line ---
  msg += `\n${memecoinEmoji} <b>Solana Memecoin Community</b> | ${solEmoji} <b>Powered by DexScreener</b>\n`;
  // --- Inline keyboard (all links/buttons at the bottom) ---
  const { inlineKeyboard } = buildInlineKeyboard(token, botUsername, pairAddress, userId);
  return { msg, inlineKeyboard };
}

function progressBar(percent: number, size = 10, fill = '█', empty = '░') {
  const filled = Math.round((percent / 100) * size);
  return fill.repeat(filled) + empty.repeat(size - filled);
}


// Notify users with matching tokens (always uses autoFilterTokens)
export async function notifyUsers(bot: any, users: Record<string, any>, tokens: any[]) {
  for (const uid of Object.keys(users)) {
    const strategy: Record<string, any> = users[uid]?.strategy || {};
    const filtered = autoFilterTokens(tokens, strategy);
    if (filtered.length > 0 && bot) {
      for (const token of filtered) {
        const chain = (token.chainId || token.chain || token.chainName || '').toString().toLowerCase();
        if (chain && !chain.includes('sol')) continue;
        let botUsername = (bot && bot.botInfo && bot.botInfo.username) ? bot.botInfo.username : (process.env.BOT_USERNAME || 'YourBotUsername');
        const address = token.tokenAddress || token.address || token.mint || token.pairAddress || 'N/A';
        const pairAddress = token.pairAddress || address;
        const { msg, inlineKeyboard } = buildTokenMessage(token, botUsername, pairAddress);
        // Extra protection: if msg is not a string, skip sending
        if (typeof msg !== 'string') {
          await bot.telegram.sendMessage(uid, '⚠️ We are still looking for the gems you want.');
          continue;
        }
        await bot.telegram.sendMessage(uid, msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
    } else if (bot) {
      await bot.telegram.sendMessage(
        uid,
        'No tokens currently match your strategy.\n\nYour strategy filters may be too strict for the available data from DexScreener.\n\nTry lowering requirements like liquidity, market cap, volume, age, or holders, then try again.',
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );
    }
  }
}


// Unified token filtering by strategy
export function autoFilterTokens(tokens: any[], strategy: Record<string, any>): any[] {
  return tokens.filter(token => {
    for (const field of STRATEGY_FIELDS) {
      if (!field.tokenField || !(field.key in strategy)) continue;
      const value = strategy[field.key];
      if (field.type === "number" && (value === undefined || value === null || Number(value) === 0)) continue;
      let tokenValue = getField(token, field.tokenField);
      // Special cases support
      if (field.tokenField === 'liquidity' && tokenValue && typeof tokenValue === 'object' && typeof tokenValue.usd === 'number') {
        tokenValue = tokenValue.usd;
      }
      if (field.tokenField === 'volume' && tokenValue && typeof tokenValue === 'object' && typeof tokenValue.h24 === 'number') {
        tokenValue = tokenValue.h24;
      }
      // Handle age specially: prefer ageSeconds if present, else try tokenValue conversions
      if (field.tokenField === 'age') {
        // Strategy value may be duration string like '30s' or number (legacy minutes)
        const minAgeSeconds = parseDuration(value) ?? undefined;
        // token may have ageSeconds, or ageMinutes, or various timestamp formats
        let tokenAgeSeconds: number | undefined = undefined;
        if (typeof token.ageSeconds === 'number' && !isNaN(token.ageSeconds)) tokenAgeSeconds = token.ageSeconds;
        else if (typeof token.ageMinutes === 'number' && !isNaN(token.ageMinutes)) tokenAgeSeconds = Math.floor(token.ageMinutes * 60);
        else if (typeof tokenValue === 'number' && !isNaN(tokenValue)) {
          // tokenValue might be a timestamp or minutes; try to detect
          if (tokenValue > 1e12) tokenAgeSeconds = Math.floor((Date.now() - tokenValue) / 1000);
          else if (tokenValue > 1e9) tokenAgeSeconds = Math.floor((Date.now() - tokenValue * 1000) / 1000);
          else tokenAgeSeconds = Math.floor(Number(tokenValue) * 60);
        }
        // If user provided a duration (minAgeSeconds) and token age unknown, fail the filter for strict fields
        if (minAgeSeconds !== undefined && (tokenAgeSeconds === undefined || isNaN(tokenAgeSeconds))) {
          if (!field.optional) return false;
          else continue;
        }
        // Attach tokenValue as seconds for subsequent comparisons
        tokenValue = tokenAgeSeconds;
      }
      // تطبيع القيمة الرقمية دائماً
      tokenValue = extractNumeric(tokenValue);
      const numValue = Number(value);
      const numTokenValue = Number(tokenValue);
      if (isNaN(numTokenValue)) {
        if (!field.optional) {
          return false;
        } else {
          continue;
        }
      }
      if (field.type === "number") {
        // For age fields, strategy values may be duration strings => parsed as seconds earlier
        let compareValue = numValue;
        // If this is an age field and user specified string durations, parseDuration will convert; otherwise use number
        if (field.tokenField === 'age') {
          const parsed = parseDuration(value);
          if (!isNaN(Number(parsed))) compareValue = parsed ?? numValue * 60; // legacy: numeric strategy considered minutes
        }
        if (field.key.startsWith("min") && !isNaN(compareValue)) {
          if (numTokenValue < compareValue) {
            return false;
          }
        }
        if (field.key.startsWith("max") && !isNaN(compareValue)) {
          if (numTokenValue > compareValue) {
            return false;
          }
        }
      }
      if (field.type === "boolean" && typeof value === "boolean") {
        if (value === true && !tokenValue) {
          return false;
        }
        if (value === false && tokenValue) {
          return false;
        }
      }
    }
    // Per-user freshness requirements (optional)
    try {
      const minFresh = strategy?.minFreshnessScore !== undefined ? Number(strategy.minFreshnessScore) : undefined;
      if (!isNaN(Number(minFresh)) && typeof token.freshnessScore === 'number') {
        if ((token.freshnessScore || 0) < Number(minFresh)) return false;
      }
      if (strategy?.requireOnchain) {
        // require on-chain first tx evidence
        const onChainTs = token?.freshnessDetails?.onChainTs || token?.freshnessDetails?.firstTxMs || null;
        if (!onChainTs) return false;
      }
    } catch (e) {
      // ignore scoring errors and proceed
    }
    return true;
  });
}

// ========== Signing Key Utilities ==========
const bs58 = require("bs58");
const { Keypair } = require("@solana/web3.js");

export function loadKeypair(secretKey: string) {
  try {
    // إذا كانت Base58
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(secretKey)) {
      return Keypair.fromSecretKey(bs58.decode(secretKey));
    }
    // إذا كانت Base64
    if (/^[A-Za-z0-9+/]+=*$/.test(secretKey)) {
      return Keypair.fromSecretKey(Buffer.from(secretKey, "base64"));
    }
    throw new Error("صيغة المفتاح غير معروفة");
  } catch (err: any) {
    throw new Error("فشل تحميل المفتاح: " + err.message);
  }
}

// ========== Timeout Utility ==========
export function withTimeout<T>(promise: Promise<T>, ms: number, source: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${source}`)), ms)
    )
  ]);
}

// ========== Logging Utility ==========
export function logTrade(trade: {
  action: string;
  source: string;
  token: string;
  amount: number;
  price: number | null;
  tx: string | null;
  latency: number;
  status: string;
}) {
  console.log(`[TRADE] ${trade.action} | ${trade.source} | Token: ${trade.token} | Amount: ${trade.amount} | Price: ${trade.price} | Tx: ${trade.tx} | Latency: ${trade.latency}ms | Status: ${trade.status}`);
}

/**
 * finalJupiterCheck: lightweight verification that a Jupiter route exists for a mint and amount.
 * Returns { ok: boolean, reason?: string }
 * This helper is intentionally permissive: when the Jupiter API is not configured it returns ok=true.
 */
export async function finalJupiterCheck(mint: string, buyAmountSol: number, opts?: { minJupiterUsd?: number; requireRoute?: boolean; timeoutMs?: number }) {
  try {
  const cfgMod = await import('../config');
  const cfg = (cfgMod as any) && ((cfgMod as any).default || cfgMod);
  const { JUPITER_QUOTE_API } = cfg || {};
    const timeout = opts?.timeoutMs || 3000;
    // If the environment does not provide a Jupiter quote API, allow by default
    if (!JUPITER_QUOTE_API) return { ok: true, reason: 'no-jupiter-api' };
    if (!mint) return { ok: false, reason: 'no-mint' };
    // Amount: default to $50 if not specified
    const amountUsd = opts?.minJupiterUsd || 50;
    const lamports = Math.floor((amountUsd / 1) * 1e9);
    const url = `${JUPITER_QUOTE_API}?inputMint=So11111111111111111111111111111111111111112&outputMint=${encodeURIComponent(mint)}&amount=${lamports}&slippage=1`;
    const axios = (await import('axios')).default;
    const res = await axios.get(url, { timeout });
    if (res && res.data) return { ok: true };
    return { ok: false, reason: 'no-data' };
  } catch (err: any) {
    // If the caller does not require Jupiter strictly, return ok=false but include reason
    return { ok: false, reason: err?.message || String(err) };
  }
}