"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRATEGY_FIELDS = void 0;
exports.getCachedFirstTx = getCachedFirstTx;
exports.setCachedFirstTx = setCachedFirstTx;
exports.getField = getField;
exports.getMissingFields = getMissingFields;
exports.parseDuration = parseDuration;
exports.normalizeMintCandidate = normalizeMintCandidate;
exports.retryAsync = retryAsync;
exports.fetchSolanaFromCoinGecko = fetchSolanaFromCoinGecko;
exports.fetchDexScreenerProfiles = fetchDexScreenerProfiles;
exports.fetchDexScreenerPairsForSolanaTokens = fetchDexScreenerPairsForSolanaTokens;
exports.fetchDexScreenerTokens = fetchDexScreenerTokens;
exports.getFirstTxTimestampFromHelius = getFirstTxTimestampFromHelius;
exports.getFirstTxTimestampFromRpc = getFirstTxTimestampFromRpc;
exports.checkOnChainActivity = checkOnChainActivity;
exports.getFirstOnchainTimestamp = getFirstOnchainTimestamp;
exports.computeFreshnessScore = computeFreshnessScore;
exports.enrichTokenTimestamps = enrichTokenTimestamps;
exports.getEnrichmentMetrics = getEnrichmentMetrics;
exports.officialEnrich = officialEnrich;
exports.fmt = fmt;
exports.buildTokenMessage = buildTokenMessage;
exports.notifyUsers = notifyUsers;
exports.autoFilterTokensVerbose = autoFilterTokensVerbose;
exports.autoFilterTokens = autoFilterTokens;
exports.loadKeypair = loadKeypair;
exports.withTimeout = withTimeout;
exports.logTrade = logTrade;
exports.finalJupiterCheck = finalJupiterCheck;
// Smart field-specific formatting for token stats
function fmtField(val, field) {
    if (val === undefined || val === null || val === '-' || val === '' || val === 'N/A' || val === 'null' || val === 'undefined')
        return 'Not available';
    let num = typeof val === 'number' ? val : Number(val);
    if (isNaN(num))
        return String(val);
    switch (field) {
        case 'price':
            if (Math.abs(num) >= 1)
                return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
            if (Math.abs(num) >= 0.01)
                return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
// Suppress noisy 429/retry lines globally (guarded so we only patch once)
try {
    // @ts-ignore
    if (!globalThis.__SUPPRESS_429_LOGS) {
        // preserve originals
        const _w = console.warn.bind(console);
        const _e = console.error.bind(console);
        const _l = console.log.bind(console);
        const _filter = /(Server responded with 429 Too Many Requests|Retrying after|Too Many Requests|entering cooldown|HTTP failure for)/i;
        console.warn = (...args) => {
            try {
                const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
                if (_filter.test(s))
                    return;
            }
            catch (e) { }
            _w(...args);
        };
        console.error = (...args) => {
            try {
                const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
                if (_filter.test(s))
                    return;
            }
            catch (e) { }
            _e(...args);
        };
        console.log = (...args) => {
            try {
                const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
                if (_filter.test(s))
                    return;
            }
            catch (e) { }
            _l(...args);
        };
        // @ts-ignore
        globalThis.__SUPPRESS_429_LOGS = true;
    }
}
catch (e) { }
// Additionally filter raw stdout/stderr writes (some libs write directly) to hide noisy 429 retry lines
try {
    // @ts-ignore
    if (!globalThis.__SUPPRESS_429_STDIO) {
        const _stdoutWrite = process.stdout.write.bind(process.stdout);
        const _stderrWrite = process.stderr.write.bind(process.stderr);
        const _filterStd = /(Server responded with 429 Too Many Requests|Retrying after|Too Many Requests|entering cooldown|HTTP failure for)/i;
        // @ts-ignore
        process.stdout.write = (chunk, encoding, cb) => {
            try {
                const s = typeof chunk === 'string' ? chunk : chunk && chunk.toString ? chunk.toString() : '';
                if (_filterStd.test(s))
                    return true;
            }
            catch (e) { }
            // @ts-ignore
            return _stdoutWrite(chunk, encoding, cb);
        };
        // @ts-ignore
        process.stderr.write = (chunk, encoding, cb) => {
            try {
                const s = typeof chunk === 'string' ? chunk : chunk && chunk.toString ? chunk.toString() : '';
                if (_filterStd.test(s))
                    return true;
            }
            catch (e) { }
            // @ts-ignore
            return _stderrWrite(chunk, encoding, cb);
        };
        // @ts-ignore
        globalThis.__SUPPRESS_429_STDIO = true;
    }
}
catch (e) { }
const axios_1 = __importDefault(require("axios"));
const web3_js_1 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
// Additional config flags used in this module
const config_2 = require("../config");
const config_3 = require("../config");
// ========== General Constants ==========
const EMPTY_VALUES = [undefined, null, '-', '', 'N/A', 'null', 'undefined'];
// Unified field map (easily extendable)
const FIELD_MAP = {
    marketCap: ['marketCap', 'fdv', 'totalAmount', 'amount'],
    liquidity: ['liquidity', 'liquidityUsd'],
    volume: ['volume', 'amount', 'totalAmount'],
    age: ['age', 'createdAt'],
};
const missingFieldsLog = new Set();
const MAX_MISSING_FIELDS = Number(process.env.MAX_MISSING_FIELDS_LOG || 200);
// Simple in-memory cache for first-tx timestamps to reduce repeat RPC/HTTP calls
const firstTxCache = new Map();
const FIRST_TX_CACHE_MS = Number(process.env.FIRST_TX_CACHE_MS || 10 * 60 * 1000);
const FIRST_TX_CACHE_FILE = process.env.FIRST_TX_CACHE_FILE || path_1.default.join(process.cwd(), '.first_tx_cache.json');
function saveFirstTxCacheToDisk() {
    try {
        const obj = {};
        for (const [k, v] of firstTxCache.entries())
            obj[k] = v;
        fs_1.default.writeFileSync(FIRST_TX_CACHE_FILE, JSON.stringify({ savedAt: Date.now(), data: obj }), { encoding: 'utf8' });
    }
    catch (e) {
        // don't fail the process for cache persistence errors
    }
}
function loadFirstTxCacheFromDisk() {
    try {
        if (!fs_1.default.existsSync(FIRST_TX_CACHE_FILE))
            return;
        const raw = fs_1.default.readFileSync(FIRST_TX_CACHE_FILE, { encoding: 'utf8' });
        const parsed = JSON.parse(raw || '{}');
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || typeof data !== 'object')
            return;
        const now = Date.now();
        for (const k of Object.keys(data)) {
            try {
                const v = data[k];
                if (!v || typeof v.ts !== 'number' || typeof v.expiresAt !== 'number')
                    continue;
                if (v.expiresAt < now)
                    continue;
                firstTxCache.set(k, { ts: v.ts, expiresAt: v.expiresAt });
            }
            catch (e) {
                continue;
            }
        }
    }
    catch (e) {
        // ignore disk load errors
    }
}
// Load persisted cache on module init (best-effort)
try {
    loadFirstTxCacheFromDisk();
}
catch (e) { }
function getCachedFirstTx(mint) {
    const v = firstTxCache.get(mint);
    if (!v)
        return null;
    if (v.expiresAt < Date.now()) {
        firstTxCache.delete(mint);
        try {
            saveFirstTxCacheToDisk();
        }
        catch { }
        return null;
    }
    return v.ts;
}
function setCachedFirstTx(mint, ts) {
    try {
        firstTxCache.set(mint, { ts, expiresAt: Date.now() + FIRST_TX_CACHE_MS });
        try {
            saveFirstTxCacheToDisk();
        }
        catch { }
    }
    catch { }
}
// Extract field value (supports nested paths)
function getField(token, ...fields) {
    for (let f of fields) {
        const mapped = FIELD_MAP[f] || [f];
        for (const mf of mapped) {
            // دعم المسارات المتداخلة
            const path = mf.split('.');
            let val = token;
            for (const key of path) {
                if (val == null)
                    break;
                val = val[key];
            }
            if (!EMPTY_VALUES.includes(val))
                return extractNumeric(val, val);
            if (mf in token && !EMPTY_VALUES.includes(token[mf]))
                return extractNumeric(token[mf], token[mf]);
        }
    }
    if (fields.length > 0) {
        try {
            if (missingFieldsLog.size < MAX_MISSING_FIELDS)
                missingFieldsLog.add(fields[0]);
        }
        catch (e) { }
    }
    return undefined;
}
// دالة لعرض الحقول المفقودة (للمطور أو المستخدم)
function getMissingFields() {
    return Array.from(missingFieldsLog);
}
// Extract a number from any value (helper)
function extractNumeric(val, fallback) {
    if (typeof val === 'number' && !isNaN(val))
        return val;
    if (typeof val === 'string' && !isNaN(Number(val)))
        return Number(val);
    if (val && typeof val === 'object') {
        for (const k of ['usd', 'h24', 'amount', 'value', 'total', 'native', 'sol']) {
            if (typeof val[k] === 'number' && !isNaN(val[k]))
                return val[k];
        }
        for (const k in val)
            if (typeof val[k] === 'number' && !isNaN(val[k]))
                return val[k];
    }
    return fallback;
}
// Parse duration input (supports numbers and strings like '30s','5m','2h')
function parseDuration(v) {
    if (v === undefined || v === null || v === '')
        return undefined;
    if (typeof v === 'number') {
    // Treat plain numeric values as seconds (explicit and unambiguous)
    const n = Number(v);
    if (isNaN(n)) return undefined;
    return Math.floor(n);
    }
    const s = String(v).trim().toLowerCase();
    const match = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)?$/);
    if (!match)
        return undefined;
    const n = Number(match[1]);
    const unit = match[2] || 'm';
    switch (unit) {
        case 's':
        case 'sec':
        case 'secs':
        case 'seconds': return Math.floor(n);
        case 'm':
        case 'min':
        case 'mins':
        case 'minutes': return Math.floor(n * 60);
        case 'h':
        case 'hr':
        case 'hrs':
        case 'hours': return Math.floor(n * 3600);
        case 'd':
        case 'day':
        case 'days': return Math.floor(n * 86400);
        default: return Math.floor(n * 60);
    }
}
// Normalize candidate mint strings: extract base58 substrings and validate via PublicKey
function normalizeMintCandidate(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    let s = raw.trim();
    // Remove common wrappers and trailing separators but keep labels like pump/bonk
    s = s.replace(/(?:\s+)?(?:\[?solana\]?|\(?sol\)?)/i, '');
    s = s.replace(/^https?:\/\/.+\//i, '');
    s = s.replace(/^chain:\w+\//i, '');
    s = s.replace(/[^A-Za-z0-9\-\_]+$/i, '');
    // If it's an obvious ethereum hex address, skip
    if (s.startsWith('0x') || /^[0-9a-fA-F]{40}$/.test(s))
        return null;
    // If the whole string is a plausible base58 public key, validate via PublicKey
    try {
        if (s.length >= 32 && s.length <= 50) {
            const pk = new web3_js_1.PublicKey(s);
            return pk.toBase58();
        }
    }
    catch (e) { }
    // Otherwise, attempt to extract the first base58-like substring (32-44 chars) from the raw string
    try {
        const m = s.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
        if (m && m.length) {
            for (const candidate of m) {
                try {
                    const pk2 = new web3_js_1.PublicKey(candidate);
                    return pk2.toBase58();
                }
                catch (e) {
                    // try next
                }
            }
        }
    }
    catch (e) { }
    // fallback: try bs58 decode to see if decodes to reasonable length
    try {
        const bs58 = require('bs58');
        const dec = bs58.decode(s);
        if (dec && dec.length >= 32)
            return s;
    }
    catch (ee) { }
    return null;
}
async function retryAsync(fn, retries = 0, delayMs = 2000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const retryAfter = err?.response?.headers?.['retry-after'];
            const wait = retryAfter ? Number(retryAfter) * 1000 : delayMs;
            if (i < retries - 1)
                await new Promise(res => setTimeout(res, wait));
        }
    }
    throw lastErr;
}
// ========== Fetch token data from CoinGecko and DexScreener ==========
async function fetchSolanaFromCoinGecko() {
    const url = 'https://api.coingecko.com/api/v3/coins/solana';
    try {
        return await retryAsync(async () => {
            const response = await axios_1.default.get(url);
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
    }
    catch (err) {
        console.error('CoinGecko fetch error:', err);
        return null;
    }
}
exports.STRATEGY_FIELDS = [
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
async function fetchDexScreenerProfiles(chainId, extraParams) {
    let url = 'https://api.dexscreener.com/token-profiles/latest/v1';
    const params = {};
    if (chainId)
        params.chainId = chainId;
    if (extraParams)
        Object.assign(params, extraParams);
    const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    if (query)
        url += `?${query}`;
    try {
        const response = await axios_1.default.get(url);
        let data = Array.isArray(response.data) ? response.data : [];
        // If API does not support filtering, fallback to local filtering
        if (chainId && data.length && !data.some(t => t.chainId === chainId)) {
            data = data.filter((t) => t.chainId === chainId);
        }
        return data;
    }
    catch (err) {
        // Log more details
        const msg = err?.message || err?.toString() || 'Unknown error';
        const status = err?.response?.status;
        const urlInfo = url;
        console.error(`DexScreener token-profiles fetch error: ${msg} (status: ${status}) [${urlInfo}]`);
        // Optionally, throw or return a special error object
        throw new Error(`Failed to fetch token profiles from DexScreener: ${msg}`);
    }
}
async function fetchDexScreenerPairsForSolanaTokens(tokenAddresses) {
    const chainId = 'solana';
    const allPairs = [];
    for (const tokenAddress of tokenAddresses) {
        const url = `https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`;
        try {
            const response = await axios_1.default.get(url);
            if (Array.isArray(response.data)) {
                allPairs.push(...response.data);
            }
        }
        catch (err) {
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
async function fetchDexScreenerTokens(chainId = 'solana', extraParams) {
    // 1. Fetch tokens from token-profiles with filtering at API level
    const profiles = await fetchDexScreenerProfiles(chainId, extraParams ?? { limit: '100' });
    // 2. Fetch pairs (market data) for each token
    const tokenAddresses = profiles.map((t) => t.tokenAddress).filter(Boolean);
    const pairs = await fetchDexScreenerPairsForSolanaTokens(tokenAddresses);
    // 3. Merge data: for each token, merge profile with pairs (market data)
    const allTokens = {};
    for (const profile of profiles) {
        const addr = profile.tokenAddress;
        if (!addr)
            continue;
        allTokens[addr] = { ...profile };
    }
    // Add pairs (market data)
    for (const pair of pairs) {
        // Each pair has baseToken.address
        const addr = getField(pair, 'baseToken.address', 'tokenAddress', 'address', 'mint', 'pairAddress');
        if (!addr)
            continue;
        if (!allTokens[addr])
            allTokens[addr] = {};
        // Merge pair data with token
        for (const key of Object.keys(FIELD_MAP)) {
            if (allTokens[addr][key] === undefined || EMPTY_VALUES.includes(allTokens[addr][key])) {
                const val = getField(pair, key);
                if (!EMPTY_VALUES.includes(val))
                    allTokens[addr][key] = val;
            }
        }
        // Get some fields from baseToken if missing
        if (pair.baseToken && typeof pair.baseToken === 'object') {
            for (const key of Object.keys(FIELD_MAP)) {
                if (allTokens[addr][key] === undefined || EMPTY_VALUES.includes(allTokens[addr][key])) {
                    const val = getField(pair.baseToken, key);
                    if (!EMPTY_VALUES.includes(val))
                        allTokens[addr][key] = val;
                }
            }
        }
        // liquidity: may be in pair.liquidity.usd or pair.liquidity
        if ((allTokens[addr].liquidity === undefined || EMPTY_VALUES.includes(allTokens[addr].liquidity)) && pair.liquidity) {
            if (typeof pair.liquidity === 'object' && typeof pair.liquidity.usd === 'number')
                allTokens[addr].liquidity = pair.liquidity.usd;
            else if (typeof pair.liquidity === 'number')
                allTokens[addr].liquidity = pair.liquidity;
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
        let createdTs = pair.pairCreatedAt ||
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
        if (!t.address)
            t.address = addr;
        if (!t.tokenAddress)
            t.tokenAddress = addr;
        if (!t.pairAddress)
            t.pairAddress = t.pairAddress || addr;
        // Ensure name/symbol fallbacks
        if (!t.name)
            t.name = (t.baseToken && t.baseToken.name) || t.tokenName || t.title || '';
        if (!t.symbol)
            t.symbol = (t.baseToken && t.baseToken.symbol) || t.ticker || '';
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
        }
        else if (typeof t.ageMinutes === 'number' && !isNaN(t.ageMinutes)) {
            // already set (assume minutes) -> normalize and provide seconds
            t.ageMinutes = Math.floor(t.ageMinutes);
            t.ageSeconds = Math.floor(t.ageMinutes * 60);
        }
        else {
            // give a safe undefined rather than various formats
            t.ageMinutes = undefined;
            t.ageSeconds = undefined;
        }
    }
    // 4. If not enough data, use CoinGecko fallback (same logic as before)
    let cgTokens = [];
    let coinGeckoFailed = false;
    if (Object.keys(allTokens).length === 0) {
        try {
            const solanaToken = await fetchSolanaFromCoinGecko();
            if (solanaToken)
                cgTokens.push(solanaToken);
            const listUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
            const listResponse = await retryAsync(() => axios_1.default.get(listUrl), 3, 3000);
            const allTokensList = listResponse.data;
            const solanaTokens = allTokensList.filter((t) => t.platforms && t.platforms.solana);
            const limited = solanaTokens.slice(0, 10);
            const details = await Promise.all(limited.map(async (t) => {
                try {
                    const url = `https://api.coingecko.com/api/v3/coins/${t.id}`;
                    const response = await retryAsync(() => axios_1.default.get(url), 3, 3000);
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
                }
                catch (err) {
                    return null;
                }
            }));
            cgTokens = cgTokens.concat(details.filter(Boolean));
        }
        catch (err) {
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
            if (!addr)
                continue;
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
            if (ct > 0 && ct < 1e12 && ct > 1e9)
                ct = ct * 1000;
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
const heliusTimestampCache = {};
// Per-host state to avoid tight retry loops when a provider starts returning 429s
const heliusHostState = {};
const enrichmentMetrics = {
    heliusCalls: 0, heliusFailures: 0, heliusTotalMs: 0,
    rpcCalls: 0, rpcFailures: 0, rpcTotalMs: 0,
    solscanCalls: 0, solscanFailures: 0, solscanTotalMs: 0
};
async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
async function getFirstTxTimestampFromRpc(address) {
    // Check lightweight global first-tx cache
    try {
        const cached = getCachedFirstTx(address);
        if (cached)
            return cached;
    }
    catch (e) { }
    try {
        const { Connection, PublicKey } = await Promise.resolve().then(() => __importStar(require('@solana/web3.js')));
        const rpcUrl = config_1.HELIUS_RPC_URL || process.env.MAINNET_RPC;
        if (!rpcUrl)
            return null;
        const conn = new Connection(rpcUrl, { commitment: 'confirmed' });
        const pub = new PublicKey(address);
        const start = Date.now();
        enrichmentMetrics.rpcCalls++;
        // Page signatures to try to reach the earliest transaction available (may be slow)
        const collectSignaturesFull = async (maxCollect = 2000) => {
            const out = [];
            let before = null;
            const limit = 1000;
            for (let i = 0; i < 5 && out.length < maxCollect; i++) {
                try {
                    const params = { limit };
                    if (before)
                        params.before = before;
                    const page = await conn.getSignaturesForAddress(pub, params);
                    if (!Array.isArray(page) || page.length === 0)
                        break;
                    out.push(...page);
                    if (page.length < limit)
                        break;
                    before = page[page.length - 1].signature || page[page.length - 1].txHash || page[page.length - 1].tx_hash || null;
                }
                catch (e) {
                    break;
                }
            }
            return out.slice(0, maxCollect);
        };
        const sigs = await collectSignaturesFull(Number(process.env.RPC_SIG_PAGE_MAX || 2000));
        if (!sigs || sigs.length === 0) {
            enrichmentMetrics.rpcTotalMs += (Date.now() - start);
            return null;
        }
        // fetch transactions in bounded concurrency and compute earliest blockTime
        let earliestMs = null;
        const concurrency = 4;
        for (let i = 0; i < sigs.length; i += concurrency) {
            const slice = sigs.slice(i, i + concurrency);
            const txs = await Promise.all(slice.map((s) => conn.getTransaction(s.signature, { commitment: 'confirmed' }).catch(() => null)));
            for (const tx of txs) {
                try {
                    const bt = tx?.blockTime;
                    if (!bt)
                        continue;
                    const ms = (bt > 1e9 && bt < 1e12) ? bt * 1000 : (bt > 1e12 ? bt : bt * 1000);
                    if (!earliestMs || ms < earliestMs)
                        earliestMs = ms;
                }
                catch (e) {
                    // ignore per-tx errors
                }
            }
            // small pause to avoid RPC bursts
            await sleep(50);
        }
        enrichmentMetrics.rpcTotalMs += (Date.now() - start);
        if (earliestMs)
            try {
                setCachedFirstTx(address, earliestMs);
            }
            catch (e) { }
        return earliestMs;
    }
    catch (e) {
        enrichmentMetrics.rpcFailures++;
        try {
            const status = e?.response?.status || e?.code || 'n/a';
            const safeSnippet = (v, n = 200) => { try {
                if (!v && v !== 0)
                    return '';
                if (typeof v === 'string')
                    return v.slice(0, n);
                return JSON.stringify(v).slice(0, n);
            }
            catch {
                try {
                    return String(v).slice(0, n);
                }
                catch {
                    return '';
                }
            } };
            const dataSnippet = (() => { try {
                const d = e?.response?.data;
                return safeSnippet(d, 200);
            }
            catch {
                return '';
            } })();
            console.error(`[RPC] getFirstTxTimestampFromRpc failed for ${address}: status=${status} msg=${String(e?.message || e)} data=${dataSnippet}`);
        }
        catch (_) { }
        return null;
    }
}
async function getFirstTxTimestampFromHelius(address) {
    // Prefer Helius RPC (if provided) which is typically higher-rate for paid keys.
    const heliusRpc = config_1.HELIUS_RPC_URL || process.env.MAINNET_RPC;
    const apiUrlTemplate = config_1.HELIUS_PARSE_HISTORY_URL || '';
    // cache check (global lightweight cache first)
    try {
        const gc = getCachedFirstTx(address);
        if (gc)
            return gc;
    }
    catch (e) { }
    // module cache
    const cached = heliusTimestampCache[address];
    const ttl = Number(config_1.HELIUS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
    if (cached && (Date.now() - cached.fetchedAt) < ttl)
        return cached.ts;
    // Helper: HTTP GET with retry/backoff honoring Retry-After
    async function heliusHttpGetWithRetries(url, maxAttempts = Number(config_1.HELIUS_RETRY_MAX_ATTEMPTS || 1)) {
        const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
        let lastErr = null;
        const baseMs = Number(config_1.HELIUS_RETRY_BASE_MS || 500);
        const jitterMs = Number(config_1.HELIUS_RETRY_JITTER_MS || 300);
        // derive host key for simple circuit breaker / cooldown
        let hostKey = null;
        try {
            hostKey = new URL(url).host;
        }
        catch (e) {
            hostKey = null;
        }
        if (hostKey) {
            const state = heliusHostState[hostKey];
            if (state && state.cooldownUntil && Date.now() < state.cooldownUntil) {
                // Fail fast silently (no repeated logs)
                const err = new Error(`Host ${hostKey} in cooldown`);
                err.code = 'HELIUS_HOST_COOLDOWN';
                throw err;
            }
        }
        // Clamp attempts to 1 if host previously entered cooldown to avoid tight retry loops
        let effectiveMaxAttempts = maxAttempts;
        try {
            const hostKeyTmp = new URL(url).host;
            const st = heliusHostState[hostKeyTmp];
            if (st && st.cooldownUntil && Date.now() < st.cooldownUntil) {
                effectiveMaxAttempts = 1;
            }
        }
        catch (e) { }
        for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
            const start = Date.now();
            try {
                enrichmentMetrics.heliusCalls++;
                const headers = { 'Accept': 'application/json' };
                try {
                    const { getHeliusApiKey, maskKey } = await Promise.resolve().then(() => __importStar(require('../config')));
                    const _hk = getHeliusApiKey();
                    if (_hk) {
                        headers['x-api-key'] = _hk;
                        try {
                            console.log(`[Helius] using key=${maskKey(_hk)}`);
                        }
                        catch (e) { }
                    }
                }
                catch (e) { }
                const r = await axios.get(url, { timeout: 20000, headers });
                enrichmentMetrics.heliusTotalMs += (Date.now() - start);
                // on success, reset host failure count
                if (hostKey && heliusHostState[hostKey]) {
                    heliusHostState[hostKey].failureCount = 0;
                    heliusHostState[hostKey].cooldownUntil = 0;
                }
                return r;
            }
            catch (err) {
                lastErr = err;
                const status = err?.response?.status;
                if (!status || status >= 500 || status === 429)
                    enrichmentMetrics.heliusFailures++;
                const retryAfter = err?.response?.headers?.['retry-after'];
                // If non-retryable client error (4xx other than 429), bail
                if (status && status >= 400 && status < 500 && status !== 429)
                    break;
                // If host is returning 429s, increment failure counter and set longer cooldown
                if (status === 429 && hostKey) {
                    const state = heliusHostState[hostKey] || { failureCount: 0, cooldownUntil: 0 };
                    state.failureCount = (state.failureCount || 0) + 1;
                    // exponential cooldown (cap at 5 minutes) + jitter
                    const cooldown = Math.min(baseMs * Math.pow(2, state.failureCount), 5 * 60 * 1000) + Math.floor(Math.random() * jitterMs);
                    state.cooldownUntil = Date.now() + cooldown;
                    heliusHostState[hostKey] = state;
                    // Avoid repeated 'Retrying...' style logging; only log when first entering cooldown
                    if (state.failureCount === 1) {
                        console.warn(`[Helius] ${hostKey} responded 429 — entering cooldown ~${Math.round(cooldown / 1000)}s`);
                    }
                    // Fail fast: do not spin retries for 429 — rely on cooldown
                    break;
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
        // Final: emit a concise single-line error (no stack) and throw, include headers/data snippets
        try {
            const status = lastErr?.response?.status || lastErr?.code || 'n/a';
            const headersSnippet = (() => { try {
                return lastErr?.response?.headers ? Object.keys(lastErr.response.headers).slice(0, 5).join(',') : '';
            }
            catch {
                return '';
            } })();
            const dataSnippet = (() => { try {
                const d = lastErr?.response?.data;
                if (!d)
                    return '';
                if (typeof d === 'string')
                    return d.slice(0, 200);
                try {
                    return JSON.stringify(d).slice(0, 200);
                }
                catch {
                    return String(d).slice(0, 200);
                }
            }
            catch {
                return '';
            } })();
            const host = hostKey || 'unknown-host';
            console.error(`[Helius] HTTP failure for ${host} after retries (status=${status}) headers=[${headersSnippet}] data=${dataSnippet} message=${String(lastErr?.message || lastErr)}`);
        }
        catch (e) {
            console.error('[Helius] HTTP failure after retries');
        }
        throw lastErr;
    }
    try {
        // Optional: try Helius WebSocket RPC when configured (preferred for live parsed streams)
        // NOTE: disabled per-address WS attempts to reduce 429s; use parse/history HTTP or RPC batch instead
        if (false && config_2.HELIUS_USE_WEBSOCKET && config_2.HELIUS_WS_URL_RAW) {
            try {
                const wsMod = await Promise.resolve().then(() => __importStar(require('ws')));
                const WebSocketCtor = (wsMod && (wsMod.default || wsMod));
                const wsUrl = config_2.HELIUS_WS_URL_RAW;
                const socket = new WebSocketCtor(wsUrl);
                // wait open
                await new Promise((resolve, reject) => {
                    const to = setTimeout(() => reject(new Error('ws open timeout')), 5000);
                    socket.once('open', () => { clearTimeout(to); resolve(null); });
                    socket.once('error', (err) => { clearTimeout(to); reject(err); });
                });
                const sigLimit = Number(config_1.HELIUS_SIG_LIMIT || 20);
                const reqId = Math.floor(Math.random() * 1e9);
                const req = { jsonrpc: '2.0', id: reqId, method: 'getSignaturesForAddress', params: [address, { limit: sigLimit }] };
                socket.send(JSON.stringify(req));
                const sigsResp = await new Promise((resolve, reject) => {
                    const to = setTimeout(() => reject(new Error('ws sigs timeout')), 10000);
                    const onMsg = (msg) => {
                        try {
                            const o = JSON.parse(msg.toString());
                            if (o.id === reqId) {
                                clearTimeout(to);
                                socket.removeListener('message', onMsg);
                                resolve(o);
                            }
                        }
                        catch (e) { }
                    };
                    socket.on('message', onMsg);
                    socket.on('error', (err) => { clearTimeout(to); socket.removeListener('message', onMsg); reject(err); });
                }).catch(() => null);
                if (sigsResp && (sigsResp.result || sigsResp.value)) {
                    const sigs = sigsResp.result || sigsResp.value;
                    let earliestMs = null;
                    // fetch transactions sequentially (bounded) to avoid bursts
                    for (const s of sigs) {
                        try {
                            const txReqId = Math.floor(Math.random() * 1e9);
                            const txReq = { jsonrpc: '2.0', id: txReqId, method: 'getTransaction', params: [s.signature, { commitment: 'confirmed' }] };
                            socket.send(JSON.stringify(txReq));
                            const txResp = await new Promise((resolve, reject) => {
                                const to = setTimeout(() => reject(new Error('ws tx timeout')), 7000);
                                const onMsg = (msg) => {
                                    try {
                                        const o = JSON.parse(msg.toString());
                                        if (o.id === txReqId) {
                                            clearTimeout(to);
                                            socket.removeListener('message', onMsg);
                                            resolve(o);
                                        }
                                    }
                                    catch (e) { }
                                };
                                socket.on('message', onMsg);
                                socket.on('error', (err) => { clearTimeout(to); socket.removeListener('message', onMsg); reject(err); });
                            }).catch(() => null);
                            const tx = txResp && (txResp.result || txResp.value) ? (txResp.result || txResp.value) : null;
                            const bt = tx?.blockTime;
                            if (bt) {
                                const ms = (bt > 1e9 && bt < 1e12) ? bt * 1000 : (bt > 1e12 ? bt : bt * 1000);
                                if (!earliestMs || ms < earliestMs)
                                    earliestMs = ms;
                            }
                        }
                        catch (e) { /* ignore per-tx failures */ }
                    }
                    try {
                        socket.close();
                    }
                    catch (e) { }
                    if (earliestMs) {
                        heliusTimestampCache[address] = { ts: earliestMs, fetchedAt: Date.now() };
                        try {
                            setCachedFirstTx(address, earliestMs);
                        }
                        catch (e) { }
                        return earliestMs;
                    }
                }
                else {
                    try {
                        socket.close();
                    }
                    catch (e) { }
                }
            }
            catch (e) {
                // websocket attempt failed - continue to next methods
                try {
                    console.warn(`[Helius] WS attempt failed for ${address}: ${e?.message || e}`);
                }
                catch (_) { }
            }
        }
        // 1) Try Helius RPC endpoint via solana web3 (best for paid keys)
        if (heliusRpc) {
            try {
                const { Connection, PublicKey } = await Promise.resolve().then(() => __importStar(require('@solana/web3.js')));
                const conn = new Connection(heliusRpc, { commitment: 'confirmed' });
                const pub = new PublicKey(address);
                const start = Date.now();
                enrichmentMetrics.heliusCalls++;
                // Page signatures to try to reach the earliest transaction available (may be slow)
                const collectSignaturesFull = async (maxCollect = Number(process.env.HELIUS_RPC_SIG_PAGE_MAX || 2000)) => {
                    const out = [];
                    let before = null;
                    const limit = Number(config_1.HELIUS_SIG_LIMIT || 1000);
                    for (let page = 0; page < 10 && out.length < maxCollect; page++) {
                        try {
                            const params = { limit };
                            if (before)
                                params.before = before;
                            const pageSigs = await conn.getSignaturesForAddress(pub, params);
                            if (!Array.isArray(pageSigs) || pageSigs.length === 0)
                                break;
                            out.push(...pageSigs);
                            if (pageSigs.length < limit)
                                break;
                            before = pageSigs[pageSigs.length - 1].signature || pageSigs[pageSigs.length - 1].txHash || pageSigs[pageSigs.length - 1].tx_hash || null;
                        }
                        catch (e) {
                            break;
                        }
                    }
                    return out.slice(0, maxCollect);
                };
                const sigs = await collectSignaturesFull(Number(process.env.HELIUS_RPC_SIG_PAGE_MAX || 2000));
                if (!sigs || sigs.length === 0) {
                    enrichmentMetrics.heliusTotalMs += (Date.now() - start);
                    // no signatures found via Helius RPC
                }
                else {
                    let earliestMs = null;
                    const concurrency = Math.max(1, Number(config_1.HELIUS_RPC_CONCURRENCY || 2));
                    for (let i = 0; i < sigs.length; i += concurrency) {
                        const slice = sigs.slice(i, i + concurrency);
                        const txs = await Promise.all(slice.map((s) => conn.getTransaction(s.signature, { commitment: 'confirmed' }).catch(() => null)));
                        for (const tx of txs) {
                            const bt = tx?.blockTime;
                            if (!bt)
                                continue;
                            const ms = (bt > 1e9 && bt < 1e12) ? bt * 1000 : (bt > 1e12 ? bt : bt * 1000);
                            if (!earliestMs || ms < earliestMs)
                                earliestMs = ms;
                        }
                        await sleep(50);
                    }
                    enrichmentMetrics.heliusTotalMs += (Date.now() - start);
                    heliusTimestampCache[address] = { ts: earliestMs, fetchedAt: Date.now() };
                    return earliestMs;
                }
            }
            catch (err) {
                try {
                    console.warn(`[Helius] RPC endpoint attempt failed for ${address}: ${err?.message || err}`);
                }
                catch (_) { }
            }
        }
        // 2) Fall back to Helius parse/history HTTP endpoints (if configured)
        if (apiUrlTemplate) {
            const url = (apiUrlTemplate.indexOf('{address}') !== -1) ? apiUrlTemplate.replace('{address}', address) : apiUrlTemplate + '&mint=' + address;
            const r = await heliusHttpGetWithRetries(url);
            const items = Array.isArray(r.data) ? r.data : (r.data?.transactions || []);
            if (!items || items.length === 0) {
                heliusTimestampCache[address] = { ts: null, fetchedAt: Date.now() };
                return null;
            }
            let earliest = Number.MAX_SAFE_INTEGER;
            for (const it of items) {
                const bt = it.blockTime || it.timestamp || (it.slot ? undefined : undefined);
                if (!bt)
                    continue;
                if (bt > 1e9 && bt < 1e12)
                    earliest = Math.min(earliest, bt * 1000);
                else if (bt > 1e12)
                    earliest = Math.min(earliest, bt);
                else if (bt < 1e9)
                    earliest = Math.min(earliest, bt * 1000);
            }
            const resultMs = (earliest === Number.MAX_SAFE_INTEGER) ? null : earliest;
            heliusTimestampCache[address] = { ts: resultMs, fetchedAt: Date.now() };
            return resultMs;
        }
        // 3) If nothing configured, return null
        return null;
    }
    catch (e) {
        // If HTTP / RPC failed: try Solscan then RPC fallback if enabled
        enrichmentMetrics.heliusFailures++;
        try {
            console.error(`[Helius] getFirstTxTimestampFromHelius failed for ${address}: ${e?.message || e}`);
        }
        catch (_) { }
        if (config_1.HELIUS_FALLBACK_ENABLED) {
            const fallback = await getFirstTxTimestampFromRpc(address);
            return fallback;
        }
        return null;
    }
}
async function getFirstTxTimestampFromSolscan(address) {
    try {
        const base = config_2.SOLSCAN_API_URL;
        if (!base)
            return null;
        const url = `${base.replace(/\/+$/, '')}/account/transactions?address=${encodeURIComponent(address)}&limit=50`;
        const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
        const start = Date.now();
        enrichmentMetrics.solscanCalls++;
        const headers = {};
        try {
            const k = (0, config_3.getSolscanApiKey)(true);
            if (k) {
                headers['x-api-key'] = k;
                try {
                    const { maskKey } = await Promise.resolve().then(() => __importStar(require('../config')));
                    console.log(`[Solscan] using key=${maskKey(k)}`);
                }
                catch (e) { }
            }
        }
        catch (e) { }
        const r = await axios.get(url, { timeout: 8000, headers });
        enrichmentMetrics.solscanTotalMs += (Date.now() - start);
        const items = Array.isArray(r.data) ? r.data : (r.data?.data || []);
        if (!items || items.length === 0) {
            enrichmentMetrics.solscanFailures++;
            return null;
        }
        let earliest = Number.MAX_SAFE_INTEGER;
        for (const it of items) {
            const bt = it.blockTime || it.block_time || it.timestamp || it.time;
            if (!bt)
                continue;
            if (bt > 1e9 && bt < 1e12)
                earliest = Math.min(earliest, bt * 1000);
            else if (bt > 1e12)
                earliest = Math.min(earliest, bt);
            else if (bt < 1e9)
                earliest = Math.min(earliest, bt * 1000);
        }
        const resultMs = (earliest === Number.MAX_SAFE_INTEGER) ? null : earliest;
        return resultMs;
    }
    catch (e) {
        enrichmentMetrics.solscanFailures++;
        try {
            const status = e?.response?.status || e?.code || 'n/a';
            const dataSnippet = (() => { try {
                const d = e?.response?.data;
                return d ? (typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d).slice(0, 200)) : '';
            }
            catch {
                return '';
            } })();
            console.error(`[Solscan] getFirstTxTimestampFromSolscan failed for ${address}: status=${status} data=${dataSnippet} msg=${String(e?.message || e)}`);
        }
        catch (_) { }
        return null;
    }
}
// ----- On-chain activity quick checks -----
async function checkOnChainActivity(address) {
    if (!address)
        return { firstTxMs: null, found: false };
    try {
        // Prefer Helius / RPC path since they tend to return parsed transactions or block times
        let ts = null;
        try {
            ts = await getFirstTxTimestampFromHelius(address);
        }
        catch (e) {
            ts = null;
        }
        // If Helius did not yield a result, fall back to RPC (skip Solscan per config)
        if (!ts) {
            try {
                ts = await getFirstTxTimestampFromRpc(address);
            }
            catch (e) {
                ts = null;
            }
        }
        if (!ts) {
            try {
                ts = await getFirstTxTimestampFromRpc(address);
            }
            catch (e) {
                ts = null;
            }
        }
        return { firstTxMs: ts, found: !!ts };
    }
    catch (err) {
        return { firstTxMs: null, found: false };
    }
}
/**
 * getFirstOnchainTimestamp: unified helper to return the earliest on-chain timestamp for a mint/address.
 * - Uses in-memory + disk cache when available.
 * - Tries Helius -> Solscan -> RPC fallbacks (configurable via environment flags in config.ts).
 * - Returns an object with ts (ms) | null, source string and cached flag.
 */
async function getFirstOnchainTimestamp(address, opts) {
    if (!address)
        return { ts: null };
    try {
        // check short-lived cache first
        try {
            const c = getCachedFirstTx(address);
            if (c)
                return { ts: c, source: 'cache', cached: true };
        }
        catch (e) { }
        const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts.timeoutMs : Number(config_2.ONCHAIN_FRESHNESS_TIMEOUT_MS || 3000);
        // Prefer Helius first, then RPC. Solscan fallback disabled per operator request.
        const order = opts?.prefer && opts.prefer.length ? opts.prefer : ['hel', 'rpc'];
        let resultMs = null;
        let source = undefined;
        for (const o of order) {
            try {
                if (o === 'hel') {
                    const ts = await withTimeout(getFirstTxTimestampFromHelius(address), timeoutMs, 'firsttx-helius');
                    if (ts) {
                        resultMs = ts;
                        source = 'hel';
                        break;
                    }
                }
                else if (o === 'rpc') {
                    const ts = await withTimeout(getFirstTxTimestampFromRpc(address), timeoutMs, 'firsttx-rpc');
                    if (ts) {
                        resultMs = ts;
                        source = 'rpc';
                        break;
                    }
                }
            }
            catch (e) {
                // continue to next source on timeout/error
            }
        }
        if (resultMs) {
            try {
                setCachedFirstTx(address, resultMs);
            }
            catch (e) { }
            return { ts: resultMs, source, cached: false };
        }
        // no timestamp found
        return { ts: null, source: 'none', cached: false };
    }
    catch (e) {
        return { ts: null };
    }
}
/**
 * Uses DexScreener / pair timestamps (token.poolOpenTimeMs, pairCreatedAt),
 * on-chain first-tx timestamps, and simple liquidity/volume heuristics.
 * Attaches token.freshnessScore and token.freshnessDetails for downstream use.
 */
async function computeFreshnessScore(token) {
    const addr = token?.tokenAddress || token?.address || token?.mint || token?.pairAddress;
    const now = Date.now();
    // Candidate timestamps
    const dsTs = token?.poolOpenTimeMs || token?.pairCreatedAt || token?.pairCreatedAtMs || null;
    let dsTsMs = null;
    if (typeof dsTs === 'number') {
        dsTsMs = dsTs;
        // normalize seconds -> ms if necessary
        if (dsTsMs && dsTsMs < 1e12 && dsTsMs > 1e9)
            dsTsMs = Math.floor(dsTsMs * 1000);
    }
    let onChainTs = null;
    // Allow env toggle to opt-out of extra on-chain calls
    const enableOnchain = config_2.ENABLE_ONCHAIN_FRESHNESS;
    if (enableOnchain && addr) {
        try {
            // Keep on-chain check short to avoid long blocking; use withTimeout utility
            const res = await withTimeout(checkOnChainActivity(addr), Number(config_2.ONCHAIN_FRESHNESS_TIMEOUT_MS || 3000), 'onchain-freshness');
            onChainTs = res.firstTxMs || null;
        }
        catch (e) {
            onChainTs = null;
        }
    }
    // Base scoring
    let score = 0;
    const details = { dsTs: dsTsMs, onChainTs };
    if (dsTsMs && onChainTs) {
        const delta = Math.abs(dsTsMs - onChainTs);
        // close agreement => high score
        if (delta <= 5 * 60 * 1000)
            score += 60, details.corroboration = 'very_close';
        else if (delta <= 60 * 60 * 1000)
            score += 45, details.corroboration = 'close';
        else if (delta <= 24 * 60 * 60 * 1000)
            score += 30, details.corroboration = 'same_day';
        else
            score += 15, details.corroboration = 'different_days';
    }
    else if (onChainTs) {
        score += 40;
        details.corroboration = 'onchain_only';
    }
    else if (dsTsMs) {
        score += 30;
        details.corroboration = 'dex_only';
    }
    else {
        score += 10;
        details.corroboration = 'no_timestamps';
    }
    // Liquidity / volume boosts (small boosts)
    const liquidity = extractNumeric(getField(token, 'liquidity')) || 0;
    const volume = extractNumeric(getField(token, 'volume')) || 0;
    if (liquidity >= 1000)
        score += 10;
    if (volume >= 100)
        score += 10;
    // Penalize extremely old tokens (unless user explicitly allows old tokens)
    const ageMinutes = typeof token.ageMinutes === 'number' ? token.ageMinutes : undefined;
    if (typeof ageMinutes === 'number' && ageMinutes > Number(config_2.FRESHNESS_MAX_AGE_MINUTES || 60 * 24 * 7)) {
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
    }
    catch (e) { /* ignore */ }
    return { score, details };
}
async function enrichTokenTimestamps(tokens, opts) {
    const batchSize = opts?.batchSize ?? Number(config_1.HELIUS_BATCH_SIZE || 4);
    const delayMs = opts?.delayMs ?? Number(config_1.HELIUS_BATCH_DELAY_MS || 400);
    const enrichLimit = Number(config_1.HELIUS_ENRICH_LIMIT || 8);
    // Build canonical address -> token map
    const addrMap = new Map();
    for (const t of tokens) {
        const key = t.tokenAddress || t.address || t.mint || t.pairAddress;
        if (key)
            addrMap.set(key, t);
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
        const results = [];
        for (const addr of batch) {
            try {
                // Prefer Helius first, then RPC fallback. Solscan disabled per operator request.
                let ts = null;
                try {
                    ts = await getFirstTxTimestampFromHelius(addr);
                }
                catch (e) {
                    ts = null;
                }
                if (!ts) {
                    try {
                        ts = await getFirstTxTimestampFromRpc(addr);
                    }
                    catch (e) {
                        ts = null;
                    }
                }
                results.push(ts);
            }
            catch (e) {
                errorCount++;
                results.push(null);
            }
        }
        // Apply results to tokens
        for (let j = 0; j < batch.length; j++) {
            const addr = batch[j];
            const tsMs = results[j];
            const token = addrMap.get(addr);
            if (!token) {
                skippedCount++;
                continue;
            }
            if (tsMs) {
                token.poolOpenTimeMs = tsMs;
                token.ageSeconds = Math.floor((Date.now() - tsMs) / 1000);
                token.ageMinutes = Math.floor(token.ageSeconds / 60);
                enrichedCount++;
            }
            else {
                skippedCount++;
            }
            // Compute a lightweight freshness score for downstream filters/notifications
            try {
                // fire-and-wait with a short timeout to avoid blocking the batch too long
                const scoreRes = await withTimeout(computeFreshnessScore(token), Number(config_2.FRESHNESS_SCORE_TIMEOUT_MS || 2000), 'freshness-score');
                // token.freshnessScore and token.freshnessDetails are set by computeFreshnessScore
            }
            catch (e) {
                // If scoring fails, continue silently; don't block notifications
            }
        }
        if (i + batchSize < toEnrich.length)
            await sleep(delayMs);
    }
    // Final concise log
    // Avoid printing repetitive messages; print a single-line summary
    console.log(`Enrichment summary: attempted=${toEnrich.length} enriched=${enrichedCount} skipped=${skippedCount} errors=${errorCount}`);
}
function getEnrichmentMetrics() {
    return { ...enrichmentMetrics };
}
/**
 * officialEnrich: perform an authoritative enrichment for a single token object.
 * - runs the existing on-chain + solscan enrichment paths (via enrichTokenTimestamps)
 * - attempts a lightweight Jupiter route check and attaches results on token.jupiter
 * - runs under the global onchainLimiter to avoid bursts
 */
async function officialEnrich(token, opts) {
    if (!token)
        return null;
    return onchainLimiter.enqueue(async () => {
        try {
            // Ensure token has canonical address
            const addr = token.tokenAddress || token.address || token.mint || token.pairAddress;
            if (!addr)
                return token;
            // Run the timestamp enrichment which will set poolOpenTimeMs/age fields
            try {
                await enrichTokenTimestamps([token], { batchSize: 1, delayMs: 0 });
            }
            catch (e) {
                // continue even if enrichment failed for this token
            }
            // Jupiter check: use minJupiterUsd when provided to avoid converting here
            try {
                const minJupiterUsd = typeof opts?.amountUsd === 'number' ? Number(opts.amountUsd) : undefined;
                const jres = await finalJupiterCheck(addr, 0, { minJupiterUsd, timeoutMs: opts?.timeoutMs || 3000 });
                token.jupiter = jres.data || null;
                token.jupiterCheck = { ok: jres.ok, reason: jres.reason || null };
            }
            catch (e) {
                token.jupiter = null;
            }
            // Recompute freshness score after enrichment
            try {
                await computeFreshnessScore(token);
            }
            catch (e) { }
            return token;
        }
        catch (e) {
            throw e;
        }
    });
}
// ========== Formatting and display functions ==========
function fmt(val, digits, unit) {
    if (val === undefined || val === null)
        return '-';
    let num = typeof val === 'number' ? val : Number(val);
    if (isNaN(num))
        return String(val);
    let usedDigits = digits !== undefined ? digits : (Math.abs(num) < 1 ? 6 : 2);
    let str = num.toLocaleString(undefined, { maximumFractionDigits: usedDigits });
    if (unit)
        str += ' ' + unit;
    return str;
}
// --- Helper functions for building the message ---
function buildInlineKeyboard(token, botUsername, pairAddress, userId) {
    const dexUrl = token.url || (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : '');
    const twitterEmoji = '🐦', dexEmoji = '🧪', shareEmoji = '📤';
    const inlineKeyboard = [];
    // Row 1: Twitter, DexScreener (only if available)
    const row1 = [];
    if (Array.isArray(token.links)) {
        for (const l of token.links) {
            if (l.type === 'twitter' && l.url)
                row1.push({ text: `${twitterEmoji} Twitter`, url: l.url });
        }
    }
    if (dexUrl)
        row1.push({ text: `${dexEmoji} DexScreener`, url: dexUrl });
    if (row1.length)
        inlineKeyboard.push(row1);
    // Row 2: Share button (external share link)
    let shareId = userId || token._userId || (token.tokenAddress || token.address || token.mint || token.pairAddress || '');
    // External share link (Telegram deep link with share parameter)
    const shareUrl = `https://t.me/share/url?url=https://t.me/${botUsername}?start=${shareId}`;
    const row2 = [{ text: `${shareEmoji} Share`, url: shareUrl }];
    inlineKeyboard.push(row2);
    return { inlineKeyboard };
}
// --- Helper functions for building the message ---
function getTokenCoreFields(token) {
    return {
        name: token.name || token.baseToken?.name || '',
        symbol: token.symbol || token.baseToken?.symbol || '',
        address: token.tokenAddress || token.address || token.mint || token.pairAddress || token.url?.split('/').pop() || '',
        dexUrl: token.url || (token.pairAddress ? `https://dexscreener.com/solana/${token.pairAddress}` : ''),
        logo: token.imageUrl || token.logoURI || token.logo || token.baseToken?.logoURI || ''
    };
}
function getTokenStats(token) {
    const price = extractNumeric(getField(token, 'priceUsd', 'price', 'baseToken.priceUsd', 'baseToken.price'), 0);
    const marketCap = extractNumeric(getField(token, 'marketCap'));
    const liquidity = extractNumeric(getField(token, 'liquidity'));
    const volume = extractNumeric(getField(token, 'volume'));
    const holders = extractNumeric(getField(token, 'holders'));
    let age = getField(token, 'age', 'createdAt');
    // حذف سطر الهولدرز نهائياً
    let ageDisplay = 'Not available';
    let ageMs = undefined;
    if (typeof age === 'string')
        age = Number(age);
    if (typeof age === 'number' && !isNaN(age)) {
        if (age > 1e12)
            ageMs = Date.now() - age; // ms timestamp
        else if (age > 1e9)
            ageMs = Date.now() - age * 1000; // s timestamp
        else if (age < 1e7 && age > 0)
            ageMs = age * 60 * 1000; // minutes
    }
    if (typeof ageMs === 'number' && !isNaN(ageMs) && ageMs > 0) {
        const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ageMs % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((ageMs % (60 * 1000)) / 1000);
        if (days > 0) {
            ageDisplay = `${days} day${days > 1 ? 's' : ''}`;
            if (hours > 0)
                ageDisplay += ` ${hours} hour${hours > 1 ? 's' : ''}`;
        }
        else if (hours > 0) {
            ageDisplay = `${hours} hour${hours > 1 ? 's' : ''}`;
            if (minutes > 0)
                ageDisplay += ` ${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
        else if (minutes > 0) {
            ageDisplay = `${minutes} minute${minutes > 1 ? 's' : ''}`;
            if (seconds > 0)
                ageDisplay += ` ${seconds} second${seconds > 1 ? 's' : ''}`;
        }
        else {
            ageDisplay = `${seconds} second${seconds > 1 ? 's' : ''}`;
        }
    }
    return { price, marketCap, liquidity, volume, holders, ageDisplay };
}
function getTokenBuySell(token) {
    const buyVol = extractNumeric(token.buyVolume || token.buy_volume || token.volumeBuy || token.volume_buy);
    const sellVol = extractNumeric(token.sellVolume || token.sell_volume || token.volumeSell || token.volume_sell);
    return { buyVol, sellVol };
}
function buildExtraFields(token) {
    // Add unimportant fields to the skip list
    const skipFields = new Set([
        'name', 'baseToken', 'tokenAddress', 'address', 'mint', 'pairAddress', 'url', 'imageUrl', 'logoURI', 'logo', 'links', 'description', 'symbol', 'priceUsd', 'price', 'marketCap', 'liquidity', 'volume', 'holders', 'age', 'genesis_date', 'pairCreatedAt',
        'icon', 'header', 'openGraph' // unimportant fields
    ]);
    let msg = '';
    for (const key of Object.keys(token)) {
        if (skipFields.has(key))
            continue;
        let value = token[key];
        if (value === undefined || value === null || value === '' || value === '-' || value === 'N/A' || value === 'null' || value === 'undefined')
            continue;
        if (typeof value === 'number') {
            msg += `<b>${key}:</b> ${fmt(value, 6)}\n`;
        }
        else if (typeof value === 'string') {
            // Don't show any image links or pictures
            if (/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)$/i.test(value)) {
                continue;
            }
            else if (/^https?:\/.*/.test(value)) {
                // If it's a link, show it as a link with an emoji only
                msg += `<b>${key}:</b> <a href='${value}'>🔗</a>\n`;
            }
            else {
                msg += `<b>${key}:</b> ${value}\n`;
            }
        }
        else if (typeof value === 'boolean') {
            msg += `<b>${key}:</b> ${value ? '✅' : '❌'}\n`;
        }
        else if (typeof value === 'object') {
            const numVal = extractNumeric(value);
            if (numVal !== undefined) {
                msg += `<b>${key}:</b> ${fmt(numVal, 6)}\n`;
            }
            else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
                msg += `<b>${key}:</b> ${value.join(', ')}\n`;
            }
        }
    }
    return msg;
}
// Small runtime helper: mirror source `nice` helper so buildTokenMessage can use it
function nice(v) {
    return (v === undefined || v === null || v === 'Not available') ? '—' : v;
}
function buildTokenMessage(token, botUsername, pairAddress, userId) {
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
    }
    else {
        msg += '\n';
    }
    msg += `${volEmoji} <b>Volume 24h:</b> ${fmtField(volume, 'volume')} USD  `;
    if (typeof volume === 'number' && !isNaN(volume) && typeof marketCap === 'number' && marketCap > 0) {
        const volPct = Math.min(100, Math.round((volume / marketCap) * 100));
        msg += progressBar(volPct, 10, '🟩', '⬜') + ` ${volPct}%\n`;
    }
    else {
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
    // include a small set of extra fields if they help users (but avoid raw debug dumps)
    const debugFields = ['freshnessScore','freshnessDetails','poolOpenTimeMs','ageSeconds','jupiterCheck'];
    const extras = {};
    for (const k of debugFields)
        if (token[k] !== undefined)
            extras[k] = token[k];
    if (Object.keys(extras).length) {
        msg += '\n<b>Details:</b>\n';
        msg += buildExtraFields(extras);
    }
    // --- Description ---
    if (token.description)
        msg += `\n<em>${token.description}</em>\n`;
    // --- Network line ---
    if (token.chainId || token.chain || token.chainName) {
        const network = token.chainId || token.chain || token.chainName;
        msg += `🌐 <b>Network:</b> ${network}\n`;
    }
    // --- Only add community/footer line ---
    msg += `\n${memecoinEmoji} <b>Solana Memecoin Community</b> | ${solEmoji} <b>Powered by DexScreener</b>\n`;
    // --- Inline keyboard (all links/buttons at the bottom) ---
    const { inlineKeyboard } = buildInlineKeyboard(token, botUsername, pairAddress, userId);
    // Also produce a Markdown variant for clients that prefer Markdown (returned for inspection)
    const esc = (s) => String(s).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
    let msgMd = '';
    msgMd += `🪙 ${name ? esc(name) : 'Unknown'}` + (symbol ? ` \`${esc(symbol)}\`` : '') + '\n';
    msgMd += `🔗 Address: \`${esc(address || 'N/A')}\`\n\n`;
    msgMd += `💰 Market Cap: ${esc(String(nice(fmtField(marketCap, 'marketCap'))))} USD\n`;
    msgMd += `💧 Liquidity: ${esc(String(nice(fmtField(liquidity, 'liquidity'))))} USD\n`;
    msgMd += `🔊 Volume 24h: ${esc(String(nice(fmtField(volume, 'volume'))))} USD\n`;
    msgMd += `⏱️ Age: ${esc(String(ageDisplay))}\n`;
    msgMd += `📈 Price: ${esc(String(fmtField(price, 'price')))} USD\n`;
    if (Object.keys(extras).length) {
        msgMd += '\n**Details:**\n';
        for (const k of Object.keys(extras)) {
            try {
                msgMd += `- ${esc(k)}: \`${esc(String(typeof extras[k] === 'object' ? JSON.stringify(extras[k]) : String(extras[k])))}\`\n`;
            }
            catch (e) { }
        }
    }
    msgMd += `\n🚀 Solana Memecoin Community | 🟣 Powered by DexScreener\n`;

    return { msg, msgMarkdown: msgMd, inlineKeyboard };
}
function progressBar(percent, size = 10, fill = '█', empty = '░') {
    const filled = Math.round((percent / 100) * size);
    return fill.repeat(filled) + empty.repeat(size - filled);
}
// Notify users with matching tokens (always uses autoFilterTokens)
async function notifyUsers(bot, users, tokens) {
    for (const uid of Object.keys(users)) {
        const strategy = users[uid]?.strategy || {};
        const filteredVerbose = autoFilterTokensVerbose(tokens, strategy);
        const filtered = (filteredVerbose && filteredVerbose.passed) ? filteredVerbose.passed : (Array.isArray(filteredVerbose) ? filteredVerbose : tokens);
        if (filtered && filtered.length > 0 && bot) {
            for (const token of filtered) {
                const chain = (token.chainId || token.chain || token.chainName || '').toString().toLowerCase();
                if (chain && !chain.includes('sol'))
                    continue;
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
        }
        else if (bot) {
            await bot.telegram.sendMessage(uid, 'No tokens currently match your strategy.\n\nYour strategy filters may be too strict for the available data from DexScreener.\n\nTry lowering requirements like liquidity, market cap, volume, age, or holders, then try again.', {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }
    }
}
// Unified token filtering by strategy
function autoFilterTokensVerbose(tokens, strategy) {
    const passed = [];
    const rejected = [];
    for (const token of tokens) {
        const reasons = [];
        let ok = true;
        for (const field of exports.STRATEGY_FIELDS) {
            if (!field.tokenField || !(field.key in strategy))
                continue;
            const value = strategy[field.key];
            if (field.type === "number" && (value === undefined || value === null || Number(value) === 0))
                continue;
            let tokenValue = getField(token, field.tokenField);
            // Special cases support
            if (field.tokenField === 'liquidity' && tokenValue && typeof tokenValue === 'object' && typeof tokenValue.usd === 'number')
                tokenValue = tokenValue.usd;
            if (field.tokenField === 'volume' && tokenValue && typeof tokenValue === 'object' && typeof tokenValue.h24 === 'number')
                tokenValue = tokenValue.h24;
            // age handling
            if (field.tokenField === 'age') {
                const minAgeSeconds = parseDuration(value) ?? undefined;
                let tokenAgeSeconds = undefined;
                if (typeof token.ageSeconds === 'number' && !isNaN(token.ageSeconds))
                    tokenAgeSeconds = token.ageSeconds;
                else if (typeof token.ageMinutes === 'number' && !isNaN(token.ageMinutes))
                    tokenAgeSeconds = Math.floor(token.ageMinutes * 60);
                else if (typeof tokenValue === 'number' && !isNaN(tokenValue)) {
                    if (tokenValue > 1e12)
                        tokenAgeSeconds = Math.floor((Date.now() - tokenValue) / 1000);
                    else if (tokenValue > 1e9)
                        tokenAgeSeconds = Math.floor((Date.now() - tokenValue * 1000) / 1000);
                    else
                        tokenAgeSeconds = Math.floor(Number(tokenValue) * 60);
                }
                if (minAgeSeconds !== undefined && (tokenAgeSeconds === undefined || isNaN(tokenAgeSeconds))) {
                    if (minAgeSeconds <= 60) {
                        // treat as ok for very small min age
                        continue;
                    }
                    if (!field.optional) {
                        reasons.push('missing_age');
                        ok = false;
                    }
                    continue;
                }
                tokenValue = tokenAgeSeconds;
            }
            tokenValue = extractNumeric(tokenValue);
            const numValue = Number(value);
            const numTokenValue = Number(tokenValue);
            if (isNaN(numTokenValue)) {
                if (!field.optional) {
                    reasons.push('missing_' + field.key);
                    ok = false;
                }
                continue;
            }
            if (field.type === "number") {
                let compareValue = numValue;
                if (field.tokenField === 'age') {
                    const parsed = parseDuration(value);
                    if (!isNaN(Number(parsed)))
                        compareValue = parsed ?? numValue * 60;
                }
                if (field.key.startsWith("min") && !isNaN(compareValue)) {
                    if (numTokenValue < compareValue) {
                        reasons.push('below_' + field.key);
                        ok = false;
                    }
                }
                if (field.key.startsWith("max") && !isNaN(compareValue)) {
                    if (numTokenValue > compareValue) {
                        reasons.push('above_' + field.key);
                        ok = false;
                    }
                }
            }
            if (field.type === "boolean" && typeof value === "boolean") {
                if (value === true && !tokenValue) {
                    reasons.push('missing_boolean_' + field.key);
                    ok = false;
                }
                if (value === false && tokenValue) {
                    reasons.push('boolean_' + field.key + '_mismatch');
                    ok = false;
                }
            }
        }
        // freshness checks
        try {
            const minFresh = strategy?.minFreshnessScore !== undefined ? Number(strategy.minFreshnessScore) : undefined;
            if (!isNaN(Number(minFresh)) && typeof token.freshnessScore === 'number') {
                if ((token.freshnessScore || 0) < Number(minFresh)) {
                    reasons.push('low_freshness');
                    ok = false;
                }
            }
            if (strategy?.requireOnchain) {
                const onChainTs = token?.freshnessDetails?.onChainTs || token?.freshnessDetails?.firstTxMs || null;
                if (!onChainTs) {
                    reasons.push('no_onchain_evidence');
                    ok = false;
                }
            }
        }
        catch (e) { }
        if (ok)
            passed.push(token);
        else
            rejected.push({ token, reasons });
    }
    return { passed, rejected };
}
function autoFilterTokens(tokens, strategy) {
    try {
        return autoFilterTokensVerbose(tokens, strategy).passed;
    }
    catch (e) {
        return tokens;
    }
}
// ========== Signing Key Utilities ==========
const bs58 = require("bs58");
const { Keypair } = require("@solana/web3.js");
function loadKeypair(secretKey) {
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
    }
    catch (err) {
        throw new Error("فشل تحميل المفتاح: " + err.message);
    }
}
// ========== Timeout Utility ==========
function withTimeout(promise, ms, source) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${source}`)), ms))
    ]);
}
// Simple concurrency limiter used to throttle on-chain/enrichment calls to avoid API 429s.
function createLimiter(maxConcurrent) {
    let running = 0;
    const q = [];
    function runNext() {
        if (running >= maxConcurrent)
            return;
        const item = q.shift();
        if (!item)
            return;
        running++;
        Promise.resolve()
            .then(() => item.fn())
            .then((res) => item.resolve(res))
            .catch((err) => item.reject(err))
            .finally(() => { running--; runNext(); });
    }
    return {
        enqueue(fn) {
            return new Promise((resolve, reject) => {
                q.push({ fn, resolve, reject });
                runNext();
            });
        },
        stats() { return { running, queued: q.length, maxConcurrent }; }
    };
}
// global limiter for on-chain enrichment calls; configurable via env
const ONCHAIN_CONCURRENCY = Number(process.env.ONCHAIN_CONCURRENCY || process.env.HELIUS_ONCHAIN_CONCURRENCY || 2);
const onchainLimiter = createLimiter(Math.max(1, ONCHAIN_CONCURRENCY));
// ========== Logging Utility ==========
function logTrade(trade) {
    console.log(`[TRADE] ${trade.action} | ${trade.source} | Token: ${trade.token} | Amount: ${trade.amount} | Price: ${trade.price} | Tx: ${trade.tx} | Latency: ${trade.latency}ms | Status: ${trade.status}`);
}
/**
 * finalJupiterCheck: lightweight verification that a Jupiter route exists for a mint and amount.
 * Returns { ok: boolean, reason?: string }
 * This helper is intentionally permissive: when the Jupiter API is not configured it returns ok=true.
 */
async function finalJupiterCheck(mint, buyAmountSol, opts) {
    try {
        const cfgMod = await Promise.resolve().then(() => __importStar(require('../config')));
        const cfg = cfgMod && (cfgMod.default || cfgMod);
        const { JUPITER_QUOTE_API } = cfg || {};
        const timeout = opts?.timeoutMs || 3000;
        // If the environment does not provide a Jupiter quote API, allow by default
        if (!JUPITER_QUOTE_API)
            return { ok: true, reason: 'no-jupiter-api' };
        if (!mint)
            return { ok: false, reason: 'no-mint' };
        // Compute lamports (amount param for Jupiter) correctly.
        // If the caller provided buyAmountSol (SOL) use that. Otherwise try to convert opts.minJupiterUsd -> SOL via CoinGecko.
        let lamports = null;
        if (typeof buyAmountSol === 'number' && buyAmountSol > 0) {
            lamports = Math.floor(buyAmountSol * 1e9);
        }
        else if (typeof opts?.minJupiterUsd === 'number') {
            // Convert USD -> SOL using a lightweight public price API (CoinGecko). If that fails, fall back to $50 ~ 1 SOL assumption (not ideal).
            try {
                const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
                const cg = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { timeout: 2000 });
                const solUsd = Number(cg.data?.solana?.usd || 0);
                const amountUsd = Number(opts.minJupiterUsd || 50);
                const solEquivalent = solUsd > 0 ? (amountUsd / solUsd) : (amountUsd / 1);
                lamports = Math.floor(solEquivalent * 1e9);
            }
            catch (e) {
                // fallback: assume 1 USD ~= 1 SOL (very rough) but ensure a minimal amount
                const amountUsd = Number(opts.minJupiterUsd || 50);
                lamports = Math.floor((amountUsd / 1) * 1e9);
            }
        }
        if (!lamports)
            lamports = Math.floor((50 / 1) * 1e9);
        const url = `${JUPITER_QUOTE_API}?inputMint=So11111111111111111111111111111111111111112&outputMint=${encodeURIComponent(mint)}&amount=${lamports}&slippage=1`;
        const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
        const headers = {};
        try {
            const { maskKey } = await Promise.resolve().then(() => __importStar(require('../config')));
            const k = (0, config_3.getJupiterApiKey)(true);
            if (k) {
                headers['x-api-key'] = k;
                try {
                    console.log(`[Jupiter] using key=${maskKey(k)}`);
                }
                catch (e) { }
            }
        }
        catch (e) { }
        const res = await axios.get(url, { timeout, headers });
        if (res && res.data)
            return { ok: true, data: res.data };
        return { ok: false, reason: 'no-data' };
    }
    catch (err) {
        // If the caller does not require Jupiter strictly, return ok=false but include reason
        return { ok: false, reason: err?.message || String(err) };
    }
}
