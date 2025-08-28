"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseKey = parseKey;
exports.loadKeypair = loadKeypair;
exports.generateKeypair = generateKeypair;
exports.exportSecretKey = exportSecretKey;
exports.getConnection = getConnection;
// Parse any key type: base58, base64, hex, mnemonic, or JSON array
const bs58_1 = __importDefault(require("bs58"));
const tweetnacl_1 = __importDefault(require("tweetnacl"));
const bip39_1 = require("bip39");
function parseKey(input) {
    // Try JSON array
    if (input.trim().startsWith('[')) {
        return loadKeypair(input);
    }
    // Try base64
    try {
        const buf = Buffer.from(input, 'base64');
        if (buf.length === 64)
            return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(buf));
    }
    catch { }
    // Try base58
    try {
        const buf = bs58_1.default.decode(input);
        if (buf.length === 64)
            return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(buf));
    }
    catch { }
    // Try hex
    try {
        if (/^[0-9a-fA-F]+$/.test(input) && input.length === 128) {
            const buf = Buffer.from(input, 'hex');
            return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(buf));
        }
    }
    catch { }
    // Try mnemonic (BIP39)
    try {
        if (input.split(' ').length >= 12) {
            const seed = (0, bip39_1.mnemonicToSeedSync)(input.trim());
            const key = tweetnacl_1.default.sign.keyPair.fromSeed(Uint8Array.from(seed.slice(0, 32)));
            return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(key.secretKey));
        }
    }
    catch { }
    throw new Error('Invalid key format. Supported: base58, base64, hex, mnemonic, JSON array.');
}
const web3_js_1 = require("@solana/web3.js");
// Load a keypair from an array, Uint8Array, or base64/JSON string
function loadKeypair(secret) {
    let key;
    if (typeof secret === 'string') {
        // Accept base64 or JSON array string
        if (secret.startsWith('[')) {
            key = Uint8Array.from(JSON.parse(secret));
        }
        else {
            key = Uint8Array.from(Buffer.from(secret, 'base64'));
        }
    }
    else if (Array.isArray(secret)) {
        key = Uint8Array.from(secret);
    }
    else if (secret instanceof Uint8Array) {
        key = secret;
    }
    else {
        throw new Error('Invalid private key type. Must be array, Uint8Array, or base64 string.');
    }
    if (key.length < 32)
        throw new Error('Invalid private key length. Must be at least 32 bytes.');
    return web3_js_1.Keypair.fromSecretKey(key);
}
// Generate a new keypair
function generateKeypair() {
    return web3_js_1.Keypair.generate();
}
// Export secret key as base64 string
function exportSecretKey(keypair) {
    return Buffer.from(keypair.secretKey).toString('base64');
}
// Create a Solana connection (Mainnet or Devnet)
const config_1 = require("./config");
function getConnection() {
    const network = process.env.NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta';
    const rpcUrl = config_1.HELIUS_RPC_URL || config_1.MAINNET_RPC || process.env.RPC_URL || (0, web3_js_1.clusterApiUrl)(network);
    return new web3_js_1.Connection(rpcUrl, 'confirmed');
}
