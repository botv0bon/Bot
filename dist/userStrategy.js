"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSolBalance = getSolBalance;
exports.recordUserTrade = recordUserTrade;
exports.getHoneySettings = getHoneySettings;
exports.setHoneySettings = setHoneySettings;
exports.addHoneyToken = addHoneyToken;
exports.removeHoneyToken = removeHoneyToken;
exports.resetHoneyTokens = resetHoneyTokens;
exports.executeHoneyStrategy = executeHoneyStrategy;
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("./src/config");
/**
 * Fetch the user's Solana balance
 */
// Simple in-memory cache for decoded Keypairs to avoid repeated expensive decoding
const __keypairCache = new Map();
async function getSolBalance(userSecret) {
    const conn = config_1.connection || new web3_js_1.Connection(process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com');
    if (!userSecret)
        return 0;
    // Try cached keypair first
    let keypair = __keypairCache.get(userSecret);
    if (!keypair) {
        let secretKey = null;
        try {
            // common encoding: base64
            secretKey = Uint8Array.from(Buffer.from(userSecret, 'base64'));
        }
        catch (e) {
            try {
                // fallback: base58
                const bs58 = require('bs58');
                secretKey = Uint8Array.from(bs58.decode(userSecret));
            }
            catch (e) {
                // final fallback: attempt JSON array
                try {
                    const arr = JSON.parse(userSecret);
                    if (Array.isArray(arr))
                        secretKey = Uint8Array.from(arr);
                }
                catch (e) {
                    secretKey = null;
                }
            }
        }
        if (!secretKey)
            throw new Error('Invalid user secret format');
        keypair = web3_js_1.Keypair.fromSecretKey(secretKey);
        try {
            __keypairCache.set(userSecret, keypair);
        }
        catch { }
    }
    const balance = await conn.getBalance(keypair.publicKey);
    return balance / 1e9; // تحويل من lamports إلى SOL
}
const fs_1 = __importDefault(require("fs"));
const fsp = fs_1.default.promises;
const path_1 = __importDefault(require("path"));
const helpers_1 = require("./src/bot/helpers");
/**
 * Record a buy or sell operation in the user's file inside sent_tokens
 */
async function recordUserTrade(userId, trade) {
    if (!userId || userId === 'undefined') {
        console.warn('[recordUserTrade] Invalid userId, skipping trade record.');
        return;
    }
    const sentTokensDir = path_1.default.join(process.cwd(), 'sent_tokens');
    try {
        await fsp.mkdir(sentTokensDir, { recursive: true });
    }
    catch { }
    const userFile = path_1.default.join(sentTokensDir, `${userId}.json`);
    let userTrades = [];
    try {
        const stat = await fsp.stat(userFile).catch(() => false);
        if (stat) {
            const data = await fsp.readFile(userFile, 'utf8');
            userTrades = JSON.parse(data || '[]');
        }
    }
    catch { }
    userTrades.push({ ...trade, time: Date.now() });
    try {
        await (0, helpers_1.writeJsonFile)(userFile, userTrades);
    }
    catch { }
}
// userStrategy.ts
require('dotenv').config();
/**
 * Get user's Honey Points strategy settings
 */
function getHoneySettings(userId, users) {
    if (!users[userId] || !users[userId].honeySettings) {
        return { tokens: [], repeatOnEntry: true };
    }
    // Ensure tokens is an array
    const settings = users[userId].honeySettings;
    return {
        tokens: Array.isArray(settings.tokens) ? settings.tokens : [],
        repeatOnEntry: typeof settings.repeatOnEntry === 'boolean' ? settings.repeatOnEntry : true
    };
}
/**
 * Save user's Honey Points strategy settings
 */
function setHoneySettings(userId, settings, users) {
    if (!users[userId])
        users[userId] = {};
    users[userId].honeySettings = settings;
}
/**
 * Add a new token to the Honey Points strategy
 */
function addHoneyToken(userId, token, users) {
    const settings = getHoneySettings(userId, users);
    if (settings.tokens.length >= 10)
        throw new Error('Maximum 10 tokens allowed.');
    // Prevent duplicates
    if (settings.tokens.some(t => t.address === token.address)) {
        throw new Error('Token already exists in strategy.');
    }
    settings.tokens.push(token);
    setHoneySettings(userId, settings, users);
}
/**
 * Remove a token from the Honey Points strategy
 */
function removeHoneyToken(userId, tokenAddress, users) {
    const settings = getHoneySettings(userId, users);
    settings.tokens = settings.tokens.filter(t => t.address !== tokenAddress);
    setHoneySettings(userId, settings, users);
}
/**
 * Reset all tokens in the Honey Points strategy
 */
function resetHoneyTokens(userId, users) {
    setHoneySettings(userId, { tokens: [], repeatOnEntry: true }, users);
}
/**
 * Execute Honey Points strategy for the user (auto buy/sell by stages)
 */
async function executeHoneyStrategy(userId, users, getPrice, autoBuy, autoSell) {
    const user = users[userId];
    if (!user || !user.secret)
        throw new Error('Wallet not found');
    const settings = getHoneySettings(userId, users);
    // Filter tokens according to user settings
    const filteredTokens = settings.tokens.filter(token => {
        // Example: Filter by volume and age (can be expanded for other fields)
        if (typeof token.volume !== 'undefined' && user.strategy?.minVolume && token.volume < user.strategy.minVolume)
            return false;
        if (typeof token.ageMinutes !== 'undefined' && user.strategy?.minAge && token.ageMinutes < user.strategy.minAge)
            return false;
        return true;
    });
    for (const token of filteredTokens) {
        // Ignore tokens with missing essential data
        if (!token.address || !token.buyAmount || !Array.isArray(token.profitPercents) || !Array.isArray(token.soldPercents) || token.profitPercents.length === 0 || token.soldPercents.length === 0) {
            token.status = 'error';
            console.warn('[executeHoneyStrategy] token missing required fields', token && token.address);
            continue;
        }
        // Ensure profit and sold arrays align
        if (token.profitPercents.length !== token.soldPercents.length) {
            token.status = 'error';
            await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'Mismatched profit/sold arrays' });
            continue;
        }
        if (token.finished) {
            token.status = 'sold';
            continue;
        }
        let currentPrice;
        try {
            currentPrice = await getPrice(token.address);
        }
        catch (e) {
            token.status = 'error';
            continue; // Skip token if price fetch fails
        }
        if (!token.lastEntryPrice) {
            // Initial buy
            try {
                // Normalize strategy for user's checks
                const finalStrategy = (user.strategy && typeof user.strategy === 'object') ? require('./src/utils/strategyNormalizer').normalizeStrategy(user.strategy) : {};
                // If Jupiter/pump requirements exist, perform a lightweight check
                const needJupiter = typeof finalStrategy.minJupiterUsd === 'number' || finalStrategy.requireJupiterRoute === true;
                // pump.fun is enrichment-only and will not be used as a blocking filter
                const needPump = false;
                if (needJupiter && token.address) {
                    try {
                        const tu = require('./src/utils/tokenUtils');
                        // prefer passing buyAmount as SOL for an accurate quote; fallback to minJupiterUsd if available
                        const jres = await tu.finalJupiterCheck(token.address, token.buyAmount || 0, { minJupiterUsd: finalStrategy.minJupiterUsd, requireRoute: finalStrategy.requireJupiterRoute, timeoutMs: 5000 });
                        token.jupiter = jres.data || null;
                        if (!jres.ok) {
                            token.status = 'error';
                            await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'Jupiter check failed: ' + (jres.reason || 'no-route') });
                            continue;
                        }
                        // If requireJupiterRoute requested but response lacks route details, fail
                        if (finalStrategy.requireJupiterRoute === true && !(jres.data?.data || jres.data?.routePlan)) {
                            token.status = 'error';
                            await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'No Jupiter route' });
                            continue;
                        }
                    }
                    catch (e) {
                        token.status = 'error';
                        await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'Jupiter check exception: ' + (e instanceof Error ? e.message : String(e)) });
                        continue;
                    }
                    // Optional pump enrichment (non-blocking)
                    try {
                        const p = await require('./src/pump/api').getCoinData(token.address);
                        token.pump = p;
                    }
                    catch (e) { }
                }
                const solBalance = await getSolBalance(user.secret);
                // Ensure user has SOL for buy amount + fee
                if (solBalance < token.buyAmount + 0.002) { // 0.002 SOL estimated for fees
                    token.status = 'error';
                    await recordUserTrade(userId, {
                        mode: 'buy',
                        token: token.address,
                        amount: token.buyAmount,
                        entryPrice: currentPrice,
                        status: 'fail',
                        error: 'Insufficient SOL balance for buy and fees',
                    });
                    continue;
                }
                const txId = await autoBuy(token.address, token.buyAmount, user.secret);
                token.lastEntryPrice = currentPrice;
                token.status = 'active';
                token.currentStage = 0;
                token.lastTxId = txId;
                await recordUserTrade(userId, {
                    mode: 'buy',
                    token: token.address,
                    amount: token.buyAmount,
                    tx: txId,
                    entryPrice: currentPrice,
                    status: 'success',
                });
            }
            catch (e) {
                token.status = 'error';
                await recordUserTrade(userId, {
                    mode: 'buy',
                    token: token.address,
                    amount: token.buyAmount,
                    entryPrice: currentPrice,
                    status: 'fail',
                    error: e instanceof Error ? e.message : String(e),
                });
                continue; // Skip if buy fails
            }
            continue;
        }
        // Profit stages
        for (let i = token.currentStage || 0; i < token.profitPercents.length; i++) {
            const target = token.lastEntryPrice * (1 + token.profitPercents[i] / 100);
            if (currentPrice >= target &&
                (!token.lastSellPrice || currentPrice > token.lastSellPrice)) {
                const sellAmount = token.buyAmount * (token.soldPercents[i] / 100);
                try {
                    // Check token SPL balance (if helper exists) and SOL fees separately.
                    let hasTokenBalance = true;
                    try {
                        const TokenService = require('./src/services/token.metadata').TokenService;
                        if (TokenService && typeof TokenService.getSPLBalance === 'function') {
                            const splbal = await TokenService.getSPLBalance(user.wallet || user.walletAddress || user.address || user.publicKey, token.address).catch(() => null);
                            // splbal may be object or number
                            const numeric = splbal && typeof splbal === 'object' && typeof splbal.uiAmount === 'number' ? splbal.uiAmount : (typeof splbal === 'number' ? splbal : null);
                            if (numeric === null || numeric < (sellAmount - 0.0000001)) {
                                hasTokenBalance = false;
                            }
                        }
                    }
                    catch (e) { /* ignore service errors, assume balance exists */ }
                    if (!hasTokenBalance) {
                        token.status = 'error';
                        await recordUserTrade(userId, {
                            mode: 'sell',
                            token: token.address,
                            amount: sellAmount,
                            sellPrice: currentPrice,
                            status: 'fail',
                            error: 'Insufficient token balance for sell',
                        });
                        continue;
                    }
                    const solBalance = await getSolBalance(user.secret);
                    if (solBalance < 0.002) {
                        token.status = 'error';
                        await recordUserTrade(userId, {
                            mode: 'sell',
                            token: token.address,
                            amount: sellAmount,
                            sellPrice: currentPrice,
                            status: 'fail',
                            error: 'Insufficient SOL for transaction fees',
                        });
                        continue;
                    }
                    const txId = await autoSell(token.address, sellAmount, user.secret);
                    token.lastSellPrice = currentPrice;
                    token.currentStage = i + 1;
                    token.lastTxId = txId;
                    await recordUserTrade(userId, {
                        mode: 'sell',
                        token: token.address,
                        amount: sellAmount,
                        tx: txId,
                        sellPrice: currentPrice,
                        status: 'success',
                    });
                    if (token.currentStage >= token.profitPercents.length) {
                        token.finished = true;
                        token.status = 'sold';
                    }
                }
                catch (e) {
                    token.status = 'error';
                    await recordUserTrade(userId, {
                        mode: 'sell',
                        token: token.address,
                        amount: sellAmount,
                        sellPrice: currentPrice,
                        status: 'fail',
                        error: e instanceof Error ? e.message : String(e),
                    });
                    continue; // Skip if sell fails
                }
            }
        }
        // If all sold and price returns, repeat if allowed
        const totalSold = token.soldPercents.reduce((a, b) => a + b, 0);
        if (totalSold >= 100 &&
            settings.repeatOnEntry &&
            currentPrice <= (token.lastEntryPrice ?? 0)) {
            token.finished = false;
            token.lastEntryPrice = undefined;
            token.lastSellPrice = undefined;
            token.status = 'pending';
            token.currentStage = 0;
            token.lastTxId = undefined;
        }
    }
    setHoneySettings(userId, settings, users);
}
