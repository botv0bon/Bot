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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWsNotifications = registerWsNotifications;
const tokenUtils_1 = require("./src/utils/tokenUtils");
const helpers_1 = require("./src/bot/helpers");
const tradeSources_1 = require("./src/tradeSources");
/**
 * Entry point for market monitoring and user notifications
 */
function registerWsNotifications(bot, users) {
    async function pollAndNotify() {
        try {
            // Fetch only Solana tokens, limit to 100, and filter by min liquidity at API level if supported
            const tokens = await (0, tokenUtils_1.fetchDexScreenerTokens)('solana', { limit: '100' });
            // Filter tokens: exclude tokens with low liquidity or marked as scam
            // Still filter for scam tokens locally
            const filteredTokens = tokens.filter((token) => {
                const notScam = !(token.baseToken?.symbol?.toLowerCase().includes('scam') || token.baseToken?.name?.toLowerCase().includes('scam'));
                return notScam;
            });
            // Import required functions
            const { buildTokenMessage } = await Promise.resolve().then(() => __importStar(require('./src/utils/tokenUtils')));
            const { filterTokensByStrategy } = await Promise.resolve().then(() => __importStar(require('./src/bot/strategy')));
            const { normalizeStrategy } = await Promise.resolve().then(() => __importStar(require('./src/utils/strategyNormalizer')));
            const { extractTradeMeta } = await Promise.resolve().then(() => __importStar(require('./src/utils/tradeMeta')));
            // Import hash and sent-tokens helpers from fastTokenFetcher
            const { hashTokenAddress, readSentHashes, appendSentHash } = await Promise.resolve().then(() => __importStar(require('./src/fastTokenFetcher')));
            for (const userId of Object.keys(users)) {
                const user = users[userId];
                // Robustly check user, wallet, and strategy
                if (!user || !user.wallet || !user.secret || !user.strategy || !user.strategy.enabled)
                    continue;
                // Normalize user's strategy then filter tokens for that user
                const normStrategy = normalizeStrategy(user.strategy);
                let userTokens = await filterTokensByStrategy(filteredTokens, normStrategy);
                // Exclude tokens already sent to this user
                const sentHashes = await readSentHashes(userId);
                userTokens = userTokens.filter(token => {
                    const addr = token.pairAddress || token.address || token.tokenAddress || '';
                    const hash = hashTokenAddress(addr);
                    return !sentHashes.has(hash);
                });
                if (!userTokens || userTokens.length === 0)
                    continue;
                // Limit number of tokens sent (e.g. first 10)
                const limitedTokens = userTokens.slice(0, 10);
                const botUsername = bot.botInfo?.username || process.env.BOT_USERNAME || 'YourBotUsername';
                for (const token of limitedTokens) {
                    const addr = token.pairAddress || token.address || token.tokenAddress || '';
                    const hash = hashTokenAddress(addr);
                    const { msg, inlineKeyboard } = buildTokenMessage(token, botUsername, addr);
                    // --- AUTO-BUY/SELL/STOP-LOSS LOGIC ---
                    try {
                        const buyAmount = Number(user.strategy.buyAmount);
                        if (!isNaN(buyAmount) && buyAmount > 0 && user.strategy.autoBuy !== false) {
                            // Only buy if not already bought (not in sentHashes)
                            // Final hard-check against normalized strategy before autoBuy
                            const finalStrategy = normalizeStrategy(user.strategy);
                            // If strategy requires Jupiter or pump info, attempt lightweight enrichment for this token
                            const mint = token.tokenAddress || token.address || token.mint || token.pairAddress;
                            try {
                                const needJupiter = typeof finalStrategy.minJupiterUsd === 'number' || finalStrategy.requireJupiterRoute === true;
                                // pump.fun will be used for enrichment/metadata only; do not require it as a hard filter
                                const needPump = false;
                                if (needJupiter) {
                                    const { JUPITER_QUOTE_API } = await Promise.resolve().then(() => __importStar(require('./src/config')));
                                    const { getCoinData } = await Promise.resolve().then(() => __importStar(require('./src/pump/api')));
                                    const mint = token.tokenAddress || token.address || token.mint || token.pairAddress;
                                    if (needJupiter && JUPITER_QUOTE_API && mint) {
                                        try {
                                            // default to $50 for quick check if min not set
                                            const amountUsd = finalStrategy.minJupiterUsd || 50;
                                            const lamports = Math.floor((amountUsd / 1) * 1e9);
                                            const url = `${JUPITER_QUOTE_API}?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippage=1`;
                                            const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
                                            const r = await axios.get(url, { timeout: 5000 });
                                            token.jupiter = r.data;
                                        }
                                        catch (e) { /* ignore */ }
                                    }
                                    // optional pump enrichment (non-blocking)
                                    try {
                                        token.pump = await getCoinData(mint);
                                    }
                                    catch (e) { }
                                }
                            }
                            catch (e) { }
                            const finalOk = await filterTokensByStrategy([token], finalStrategy);
                            if (!finalOk || finalOk.length === 0) {
                                // skip buy - token does not meet user's strategy anymore
                                continue;
                            }
                            // Final Jupiter simulation check before executing actual buy
                            try {
                                const { finalJupiterCheck } = await Promise.resolve().then(() => __importStar(require('./src/utils/tokenUtils')));
                                const buyAmt = Number(user.strategy.buyAmount) || 0.01;
                                const jres = await finalJupiterCheck(mint, buyAmt, { minJupiterUsd: finalStrategy.minJupiterUsd, requireRoute: finalStrategy.requireJupiterRoute, timeoutMs: 3000 });
                                if (!jres.ok) {
                                    await bot.telegram.sendMessage(userId, `⚠️ Skipped AutoBuy for ${mint}: Jupiter check failed (${jres.reason})`, { parse_mode: 'HTML' });
                                    continue;
                                }
                            }
                            catch (e) { }
                            const result = await (0, tradeSources_1.unifiedBuy)(addr, buyAmount, user.secret);
                            const { fee, slippage } = extractTradeMeta(result, 'buy');
                            const resSource = result?.source ?? 'unknown';
                            const resTx = result?.tx ?? '';
                            if (!user.history)
                                user.history = [];
                            user.history.push(`AutoBuy: ${addr} | Amount: ${buyAmount} SOL | Source: ${resSource} | Tx: ${resTx} | Fee: ${fee ?? 'N/A'} | Slippage: ${slippage ?? 'N/A'}`);
                            (0, helpers_1.saveUsers)(users);
                            let buyMsg = `✅ <b>AutoBuy Executed</b>\nToken: <code>${addr}</code>\nAmount: <b>${buyAmount}</b> SOL\nSource: <b>${resSource}</b>`;
                            if (resTx)
                                buyMsg += `\n<a href='https://solscan.io/tx/${resTx}'>View Tx</a>`;
                            if (fee != null)
                                buyMsg += `\nFee: <b>${fee}</b>`;
                            if (slippage != null)
                                buyMsg += `\nSlippage: <b>${slippage}</b>`;
                            await bot.telegram.sendMessage(userId, buyMsg, { parse_mode: 'HTML', disable_web_page_preview: false });
                            // --- AUTO-SELL/STOP-LOSS LOGIC ---
                            const buyPrice = Number(token.priceUsd || token.price || 0);
                            const profitTargetPercent = Number(user.strategy.profitTargetPercent || user.strategy.sellPercent1 || 0);
                            const stopLossPercent = Number(user.strategy.stopLossPercent || 0);
                            let sold = false;
                            let pollCount = 0;
                            const maxPolls = 60; // e.g. check for 1 hour (60 min)
                            while (!sold && pollCount < maxPolls) {
                                await new Promise(res => setTimeout(res, 60 * 1000)); // 1 min
                                pollCount++;
                                // Fetch latest price
                                const freshTokens = await (0, tokenUtils_1.fetchDexScreenerTokens)('solana', { limit: '100' });
                                const fresh = freshTokens.find((t) => (t.pairAddress || t.address || t.tokenAddress || '') === addr);
                                if (!fresh)
                                    continue;
                                const currentPrice = Number(fresh.priceUsd || fresh.price || 0);
                                if (!currentPrice || !buyPrice)
                                    continue;
                                const changePercent = ((currentPrice - buyPrice) / buyPrice) * 100;
                                // Check profit target
                                if (profitTargetPercent && changePercent >= profitTargetPercent) {
                                    try {
                                        const sellResult = await (0, tradeSources_1.unifiedSell)(addr, buyAmount, user.secret);
                                        const { fee: sellFee, slippage: sellSlippage } = extractTradeMeta(sellResult, 'sell');
                                        const sellSource = sellResult?.source ?? 'unknown';
                                        const sellTx = sellResult?.tx ?? '';
                                        user.history.push(`AutoSell: ${addr} | Amount: ${buyAmount} SOL | Source: ${sellSource} | Tx: ${sellTx} | Fee: ${sellFee ?? 'N/A'} | Slippage: ${sellSlippage ?? 'N/A'}`);
                                        (0, helpers_1.saveUsers)(users);
                                        let sellMsg = `💰 <b>AutoSell (Profit Target) Executed</b>\nToken: <code>${addr}</code>\nProfit: <b>${changePercent.toFixed(2)}%</b>`;
                                        if (sellTx)
                                            sellMsg += `\n<a href='https://solscan.io/tx/${sellTx}'>View Tx</a>`;
                                        if (sellFee != null)
                                            sellMsg += `\nFee: <b>${sellFee}</b>`;
                                        if (sellSlippage != null)
                                            sellMsg += `\nSlippage: <b>${sellSlippage}</b>`;
                                        await bot.telegram.sendMessage(userId, sellMsg, { parse_mode: 'HTML', disable_web_page_preview: false });
                                        sold = true;
                                        break;
                                    }
                                    catch (err) {
                                        await bot.telegram.sendMessage(userId, `❌ <b>AutoSell Failed</b>\nToken: <code>${addr}</code>\nError: ${err.message || err}`, { parse_mode: 'HTML' });
                                    }
                                }
                                // Check stop loss
                                if (stopLossPercent && changePercent <= -Math.abs(stopLossPercent)) {
                                    try {
                                        const sellResult = await (0, tradeSources_1.unifiedSell)(addr, buyAmount, user.secret);
                                        const { fee: sellFee, slippage: sellSlippage } = extractTradeMeta(sellResult, 'sell');
                                        const sellSource = sellResult?.source ?? 'unknown';
                                        const sellTx = sellResult?.tx ?? '';
                                        user.history.push(`AutoSell (StopLoss): ${addr} | Amount: ${buyAmount} SOL | Source: ${sellSource} | Tx: ${sellTx} | Fee: ${sellFee ?? 'N/A'} | Slippage: ${sellSlippage ?? 'N/A'}`);
                                        (0, helpers_1.saveUsers)(users);
                                        let sellMsg = `🛑 <b>AutoSell (Stop Loss) Executed</b>\nToken: <code>${addr}</code>\nLoss: <b>${changePercent.toFixed(2)}%</b>`;
                                        if (sellTx)
                                            sellMsg += `\n<a href='https://solscan.io/tx/${sellTx}'>View Tx</a>`;
                                        if (sellFee != null)
                                            sellMsg += `\nFee: <b>${sellFee}</b>`;
                                        if (sellSlippage != null)
                                            sellMsg += `\nSlippage: <b>${sellSlippage}</b>`;
                                        await bot.telegram.sendMessage(userId, sellMsg, { parse_mode: 'HTML', disable_web_page_preview: false });
                                        sold = true;
                                        break;
                                    }
                                    catch (err) {
                                        await bot.telegram.sendMessage(userId, `❌ <b>AutoSell (Stop Loss) Failed</b>\nToken: <code>${addr}</code>\nError: ${err.message || err}`, { parse_mode: 'HTML' });
                                    }
                                }
                            }
                            // --- END AUTO-SELL/STOP-LOSS LOGIC ---
                        }
                    }
                    catch (err) {
                        await bot.telegram.sendMessage(userId, `❌ <b>AutoBuy Failed</b>\nToken: <code>${addr}</code>\nError: ${err.message || err}`, { parse_mode: 'HTML' });
                    }
                    // --- END AUTO-BUY/SELL/STOP-LOSS LOGIC ---
                    if (msg && typeof msg === 'string') {
                        try {
                            await bot.telegram.sendMessage(userId, msg, {
                                parse_mode: 'HTML',
                                disable_web_page_preview: false,
                                reply_markup: { inline_keyboard: inlineKeyboard }
                            });
                            await appendSentHash(userId, hash);
                        }
                        catch (err) {
                            console.error(`Failed to send message to user ${userId}:`, err);
                        }
                    }
                }
            }
        }
        catch (err) {
            console.error('Error in pollAndNotify:', err);
        }
    }
    setInterval(pollAndNotify, 60 * 1000);
    pollAndNotify();
}
