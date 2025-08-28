"use strict";
// portfolioCopyMonitor.ts
// Copy Trading Monitoring logic for Telegram bot
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitorCopiedWallets = monitorCopiedWallets;
// Last executed transaction for each copied wallet to prevent duplicates
const lastExecutedTx = {};
/**
 * Monitors copied wallets and executes trades for users as needed.
 * This function should be called periodically from the main bot file.
 * @param trackerUsers - Object mapping userId to TrackerUser info
 */
const node_fetch_1 = __importDefault(require("node-fetch"));
// Use runtime requires for optional modules to avoid type errors
let autoBuy;
let sellWithOrca;
let bot;
try {
    autoBuy = require('../utils/autoBuy').autoBuy;
}
catch (e) {
    autoBuy = null;
}
try {
    sellWithOrca = require('../sell').sellWithOrca;
}
catch (e) {
    sellWithOrca = null;
}
try {
    bot = require('../telegramBot').bot;
}
catch (e) {
    bot = null;
}
// Helper: Fetch recent trades for a wallet from Birdeye API
async function fetchRecentTrades(wallet) {
    try {
        const res = await (0, node_fetch_1.default)(`https://public-api.birdeye.so/public/wallet/txs?address=${wallet}&limit=5`);
        const data = await res.json();
        if (!Array.isArray(data?.data))
            return [];
        // Convert Birdeye transactions to unified model
        return data.data
            .filter((tx) => tx.type === 'buy' || tx.type === 'sell')
            .map((tx) => ({
            token: tx.token_address,
            amount: tx.token_amount,
            type: tx.type,
            tx: tx.tx_hash
        }));
    }
    catch {
        return [];
    }
}
// Helper: Execute a copy trade for a user
async function executeCopyTrade(user, trade) {
    try {
        if (trade.type === 'buy') {
            if (!autoBuy)
                throw new Error('autoBuy not available');
            return await autoBuy(trade.token, trade.amount, user.secret);
        }
        else {
            if (!sellWithOrca)
                throw new Error('sellWithOrca not available');
            const tx = await sellWithOrca(trade.token, trade.amount);
            return typeof tx === 'string' ? tx : 'done';
        }
    }
    catch (e) {
        return 'error: ' + (e?.message || 'Unknown');
    }
}
// Helper: Notify user via Telegram bot
function notifyUser(userId, message) {
    if (bot && bot.telegram && typeof bot.telegram.sendMessage === 'function') {
        bot.telegram.sendMessage(userId, message);
    }
}
// Main monitoring logic
async function monitorCopiedWallets(trackerUsers) {
    for (const userId in trackerUsers) {
        const user = trackerUsers[userId];
        for (const copiedWallet of user.copiedWallets) {
            // Fetch recent trades from copied wallet
            const trades = await fetchRecentTrades(copiedWallet);
            for (const trade of trades) {
                // Prevent duplicate execution: only execute if not already done
                if (lastExecutedTx[copiedWallet] === trade.tx)
                    continue;
                const tx = await executeCopyTrade(user, trade);
                notifyUser(user.userId, `Copied ${trade.type} of ${trade.token} (${trade.amount}) from wallet ${copiedWallet}. Tx: ${tx}`);
                lastExecutedTx[copiedWallet] = trade.tx;
            }
        }
    }
}
// You can add more helper functions here as needed for copy trading logic
