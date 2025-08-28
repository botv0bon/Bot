"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connection = exports.private_connection = exports.FRESHNESS_SCORE_TIMEOUT_MS = exports.FRESHNESS_MAX_AGE_MINUTES = exports.ONCHAIN_FRESHNESS_TIMEOUT_MS = exports.ENABLE_ONCHAIN_FRESHNESS = exports.SOLSCAN_FALLBACK_ENABLED = exports.SOLSCAN_API_URL = exports.HELIUS_ENRICH_LIMIT = exports.HELIUS_BATCH_DELAY_MS = exports.HELIUS_BATCH_SIZE = exports.HELIUS_RPC_CONCURRENCY = exports.HELIUS_SIG_LIMIT = exports.HELIUS_FALLBACK_ENABLED = exports.HELIUS_RETRY_JITTER_MS = exports.HELIUS_RETRY_BASE_MS = exports.HELIUS_RETRY_MAX_ATTEMPTS = exports.HELIUS_CACHE_TTL_MS = exports.HELIUS_SUBSCRIBE_SPLTOKEN = exports.HELIUS_SUBSCRIBE_METADATA = exports.HELIUS_USE_WEBSOCKET = exports.HELIUS_PARSE_HISTORY_URL = exports.HELIUS_RPC_URL = exports.HELIUS_WS_URL_RAW = exports.HELIUS_API_KEYS = exports.HELIUS_API_KEY = exports.RESERVE_WALLET = exports.JUPITER_API_KEYS = exports.SOLSCAN_API_KEYS = exports.JUPITER_SWAP_API = exports.JUPITER_QUOTE_API = exports.RPC_WEBSOCKET_ENDPOINT = exports.MAINNET_RPC = exports.NETWORK = exports.PRIVATE_KEY = exports.TOKEN_MINT = exports.BOT_WALLET_ADDRESS = exports.TELEGRAM_USER_ID = exports.TELEGRAM_BOT_TOKEN = exports.DEXSCREENER_API_ENDPOINT_BOOSTS_TOP = exports.DEXSCREENER_API_ENDPOINT_ORDERS = exports.DEXSCREENER_API_ENDPOINT_PAIR_DETAILS = exports.DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS = exports.DEXSCREENER_API_ENDPOINT_SEARCH = exports.DEXSCREENER_API_ENDPOINT_BOOSTS = exports.DEXSCREENER_API_TYPE = exports.REQUEST_HEADER = exports.BIRDEYE_API_URL = void 0;
exports.getSolscanApiKey = getSolscanApiKey;
exports.getJupiterApiKey = getJupiterApiKey;
exports.getHeliusApiKey = getHeliusApiKey;
exports.maskKey = maskKey;
exports.getHeliusWebsocketUrl = getHeliusWebsocketUrl;
// إعدادات Birdeye
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Centralized config & env parsing for the project.
// Export well-typed constants and helpers so other modules don't read process.env directly.
const web3_js_1 = require("@solana/web3.js");
exports.BIRDEYE_API_URL = process.env.BIRDEYE_API_URL || "https://public-api.birdeye.so/defi/price";
exports.REQUEST_HEADER = { accept: "application/json", "x-api-key": process.env.BIRDEYE_API_KEY || "" };
exports.DEXSCREENER_API_TYPE = process.env.DEXSCREENER_API_TYPE || "boosts";
exports.DEXSCREENER_API_ENDPOINT_BOOSTS = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS;
exports.DEXSCREENER_API_ENDPOINT_SEARCH = process.env.DEXSCREENER_API_ENDPOINT_SEARCH;
exports.DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS = process.env.DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS;
exports.DEXSCREENER_API_ENDPOINT_PAIR_DETAILS = process.env.DEXSCREENER_API_ENDPOINT_PAIR_DETAILS;
exports.DEXSCREENER_API_ENDPOINT_ORDERS = process.env.DEXSCREENER_API_ENDPOINT_ORDERS;
exports.DEXSCREENER_API_ENDPOINT_BOOSTS_TOP = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS_TOP;
exports.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
exports.TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
exports.BOT_WALLET_ADDRESS = process.env.BOT_WALLET_ADDRESS;
exports.TOKEN_MINT = process.env.TOKEN_MINT;
exports.PRIVATE_KEY = process.env.PRIVATE_KEY;
exports.NETWORK = process.env.NETWORK || "mainnet";
// RPC / endpoints
exports.MAINNET_RPC = process.env.MAINNET_RPC || process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
exports.RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT || process.env.WS_ENDPOINT || '';
exports.JUPITER_QUOTE_API = process.env.JUPITER_QUOTE_API;
exports.JUPITER_SWAP_API = process.env.JUPITER_SWAP_API;
// Support rotating keys for Solscan and Jupiter (comma-separated env vars)
exports.SOLSCAN_API_KEYS = (process.env.SOLSCAN_API_KEYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
exports.JUPITER_API_KEYS = (process.env.JUPITER_API_KEYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
let __solscanKeyIndex = 0;
let __jupiterKeyIndex = 0;
function getSolscanApiKey(rotate = true) {
    try {
        if (exports.SOLSCAN_API_KEYS && exports.SOLSCAN_API_KEYS.length) {
            const k = exports.SOLSCAN_API_KEYS[__solscanKeyIndex % exports.SOLSCAN_API_KEYS.length];
            if (rotate)
                __solscanKeyIndex = (__solscanKeyIndex + 1) % exports.SOLSCAN_API_KEYS.length;
            return k;
        }
    }
    catch (e) { }
    return null;
}
function getJupiterApiKey(rotate = true) {
    try {
        if (exports.JUPITER_API_KEYS && exports.JUPITER_API_KEYS.length) {
            const k = exports.JUPITER_API_KEYS[__jupiterKeyIndex % exports.JUPITER_API_KEYS.length];
            if (rotate)
                __jupiterKeyIndex = (__jupiterKeyIndex + 1) % exports.JUPITER_API_KEYS.length;
            return k;
        }
    }
    catch (e) { }
    return null;
}
exports.RESERVE_WALLET = process.env.RESERVE_WALLET || "11111111111111111111111111111111";
// Helius specific envs
exports.HELIUS_API_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || '';
// Support multiple Helius API keys via comma-separated env var HELIUS_API_KEYS
exports.HELIUS_API_KEYS = (process.env.HELIUS_API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
// Internal rotating index (module-scoped)
let __heliusKeyIndex = 0;
/**
 * Get a Helius API key. If multiple keys are configured via HELIUS_API_KEYS,
 * this function returns keys in a round-robin fashion. If no keys are
 * configured, it falls back to HELIUS_API_KEY.
 *
 * @param rotate whether to advance the rotation index (default: true)
 */
function getHeliusApiKey(rotate = true) {
    try {
        if (Array.isArray(exports.HELIUS_API_KEYS) && exports.HELIUS_API_KEYS.length > 0) {
            const key = exports.HELIUS_API_KEYS[__heliusKeyIndex % exports.HELIUS_API_KEYS.length];
            if (rotate)
                __heliusKeyIndex = (__heliusKeyIndex + 1) % exports.HELIUS_API_KEYS.length;
            return key;
        }
    }
    catch (e) { }
    return exports.HELIUS_API_KEY;
}
// Utility to partially mask API keys for safe logging
function maskKey(k) {
    if (!k)
        return '';
    try {
        const s = String(k);
        if (s.length <= 8)
            return s.replace(/.(?=.{2})/g, '*');
        return s.slice(0, 4) + '...' + s.slice(-4);
    }
    catch (e) {
        return '***';
    }
}
exports.HELIUS_WS_URL_RAW = process.env.HELIUS_WEBSOCKET_URL || process.env.HELIUS_FAST_RPC_URL || '';
exports.HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || process.env.MAINNET_RPC || '';
exports.HELIUS_PARSE_HISTORY_URL = process.env.HELIUS_PARSE_HISTORY_URL || process.env.HELIUS_PARSE_TX_URL || '';
exports.HELIUS_USE_WEBSOCKET = (process.env.HELIUS_USE_WEBSOCKET || 'false').toLowerCase() === 'true';
exports.HELIUS_SUBSCRIBE_METADATA = (process.env.HELIUS_SUBSCRIBE_METADATA || 'true').toLowerCase() === 'true';
exports.HELIUS_SUBSCRIBE_SPLTOKEN = (process.env.HELIUS_SUBSCRIBE_SPLTOKEN || 'true').toLowerCase() === 'true';
// Additional Helius tuning envs
exports.HELIUS_CACHE_TTL_MS = Number(process.env.HELIUS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
exports.HELIUS_RETRY_MAX_ATTEMPTS = Number(process.env.HELIUS_RETRY_MAX_ATTEMPTS || 1);
exports.HELIUS_RETRY_BASE_MS = Number(process.env.HELIUS_RETRY_BASE_MS || 500);
exports.HELIUS_RETRY_JITTER_MS = Number(process.env.HELIUS_RETRY_JITTER_MS || 300);
exports.HELIUS_FALLBACK_ENABLED = (process.env.HELIUS_FALLBACK_ENABLED || 'true').toLowerCase() === 'true';
exports.HELIUS_SIG_LIMIT = Number(process.env.HELIUS_SIG_LIMIT || 20);
exports.HELIUS_RPC_CONCURRENCY = Number(process.env.HELIUS_RPC_CONCURRENCY || 2);
exports.HELIUS_BATCH_SIZE = Number(process.env.HELIUS_BATCH_SIZE || 4);
exports.HELIUS_BATCH_DELAY_MS = Number(process.env.HELIUS_BATCH_DELAY_MS || 400);
exports.HELIUS_ENRICH_LIMIT = Number(process.env.HELIUS_ENRICH_LIMIT || 8);
// Solscan and on-chain freshness toggles
exports.SOLSCAN_API_URL = process.env.SOLSCAN_API_URL || '';
exports.SOLSCAN_FALLBACK_ENABLED = (process.env.SOLSCAN_FALLBACK_ENABLED || 'true').toLowerCase() === 'true';
exports.ENABLE_ONCHAIN_FRESHNESS = (process.env.ENABLE_ONCHAIN_FRESHNESS || 'true').toLowerCase() === 'true';
exports.ONCHAIN_FRESHNESS_TIMEOUT_MS = Number(process.env.ONCHAIN_FRESHNESS_TIMEOUT_MS || 3000);
exports.FRESHNESS_MAX_AGE_MINUTES = Number(process.env.FRESHNESS_MAX_AGE_MINUTES || 60 * 24 * 7);
exports.FRESHNESS_SCORE_TIMEOUT_MS = Number(process.env.FRESHNESS_SCORE_TIMEOUT_MS || 2000);
// Build Helius WebSocket URL (append API key if needed)
function getHeliusWebsocketUrl() {
    let base = exports.HELIUS_WS_URL_RAW || '';
    if (!base)
        return '';
    try {
        const u = new URL(base);
        // If api key is not provided in query, append as x-api-key or api-key if present
        // prefer rotating key(s) when available
        const heliusKey = getHeliusApiKey();
        if (heliusKey && !u.searchParams.get('api-key') && !u.searchParams.get('x-api-key') && !u.searchParams.get('key')) {
            u.searchParams.set('x-api-key', heliusKey);
        }
        return u.toString();
    }
    catch (e) {
        // not a full URL, try to append query
        if (exports.HELIUS_API_KEY && base.indexOf('?') === -1)
            return `${base}?x-api-key=${exports.HELIUS_API_KEY}`;
        if (exports.HELIUS_API_KEY)
            return `${base}&x-api-key=${exports.HELIUS_API_KEY}`;
        return base;
    }
}
// Shared connection exported for reuse
exports.private_connection = new web3_js_1.Connection(exports.MAINNET_RPC);
exports.connection = exports.private_connection;
