

// إعدادات Birdeye
export const BIRDEYE_API_URL = "https://public-api.birdeye.so/defi/price";
export const REQUEST_HEADER = { "accept": "application/json", "x-api-key": process.env.BIRDEYE_API_KEY || "" };

// إعدادات DexScreener
export const DEXSCREENER_API_TYPE = process.env.DEXSCREENER_API_TYPE || "boosts";
export const DEXSCREENER_API_ENDPOINT_BOOSTS = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS;
export const DEXSCREENER_API_ENDPOINT_SEARCH = process.env.DEXSCREENER_API_ENDPOINT_SEARCH;
export const DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS = process.env.DEXSCREENER_API_ENDPOINT_TOKEN_PAIRS;
export const DEXSCREENER_API_ENDPOINT_PAIR_DETAILS = process.env.DEXSCREENER_API_ENDPOINT_PAIR_DETAILS;
export const DEXSCREENER_API_ENDPOINT_ORDERS = process.env.DEXSCREENER_API_ENDPOINT_ORDERS;
export const DEXSCREENER_API_ENDPOINT_BOOSTS_TOP = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS_TOP;

// إعدادات البوت والمحفظة
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
export const BOT_WALLET_ADDRESS = process.env.BOT_WALLET_ADDRESS;
export const TOKEN_MINT = process.env.TOKEN_MINT;
export const PRIVATE_KEY = process.env.PRIVATE_KEY;
export const NETWORK = process.env.NETWORK || "mainnet";

// إعدادات الشبكة والـ RPC
export const MAINNET_RPC = process.env.MAINNET_RPC;
export const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT;

// إعدادات جوبتر
export const JUPITER_QUOTE_API = process.env.JUPITER_QUOTE_API;
export const JUPITER_SWAP_API = process.env.JUPITER_SWAP_API;

export const RESERVE_WALLET = process.env.RESERVE_WALLET || "11111111111111111111111111111111";

// اتصال خاص بالشبكة
import { Connection } from "@solana/web3.js";
export const private_connection = new Connection(MAINNET_RPC || "https://api.mainnet-beta.solana.com");
export const connection = private_connection;
