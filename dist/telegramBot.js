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
// =================== Imports ===================
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const fsp = fs_1.default.promises;
const telegraf_1 = require("telegraf");
const helpers_1 = require("./src/bot/helpers");
const tradeSources_1 = require("./src/tradeSources");
const strategy_1 = require("./src/bot/strategy");
const autoStrategyExecutor_1 = require("./src/autoStrategyExecutor");
const tokenUtils_1 = require("./src/utils/tokenUtils");
const enrichQueue_1 = require("./src/bot/enrichQueue");
const buySellHandlers_1 = require("./src/bot/buySellHandlers");
const strategyNormalizer_1 = require("./src/utils/strategyNormalizer");
const fastTokenFetcher_1 = require("./src/fastTokenFetcher");
const wallet_1 = require("./src/wallet");
// Install a small console filter to suppress noisy 429/retry messages coming from HTTP libs
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
const _origLog = console.log.bind(console);
const _filterRegex = /(Server responded with 429 Too Many Requests|Retrying after|Too Many Requests|entering cooldown)/i;
console.warn = (...args) => {
    try {
        const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        if (_filterRegex.test(s))
            return; // drop noisy retry/429 lines
    }
    catch (e) { }
    _origWarn(...args);
};
console.error = (...args) => {
    try {
        const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        if (_filterRegex.test(s))
            return;
    }
    catch (e) { }
    _origError(...args);
};
console.log = (...args) => {
    try {
        const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        if (_filterRegex.test(s))
            return;
    }
    catch (e) { }
    _origLog(...args);
};
console.log('--- Bot starting: Imports loaded ---');
dotenv_1.default.config();
// Configuration values (can be overridden via .env). Using environment variables
// makes deployment/runtime configuration flexible per environment.
const HELIUS_BATCH_SIZE = Number(process.env.HELIUS_BATCH_SIZE ?? 8);
const HELIUS_BATCH_DELAY_MS = Number(process.env.HELIUS_BATCH_DELAY_MS ?? 250);
const HELIUS_ENRICH_LIMIT = Number(process.env.HELIUS_ENRICH_LIMIT ?? 25);
const ONCHAIN_FRESHNESS_TIMEOUT_MS = Number(process.env.ONCHAIN_FRESHNESS_TIMEOUT_MS ?? 5000);
console.log('--- dotenv loaded ---');
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_TOKEN);
if (!TELEGRAM_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not found in .env file. Please add TELEGRAM_BOT_TOKEN=YOUR_TOKEN to .env');
    process.exit(1);
}
const bot = new telegraf_1.Telegraf(TELEGRAM_TOKEN);
console.log('--- Telegraf instance created ---');
let users = {};
console.log('--- Users placeholder created ---');
let globalTokenCache = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 1000 * 60 * 2;
let boughtTokens = {};
const restoreStates = {};
// Per-user token cache to allow fetching tailored token lists per-user strategy
const userTokenCache = {};
async function getTokensForUser(userId, strategy) {
    const now = Date.now();
    // If user has no strategy or empty filters, reuse global cache for efficiency
    if (!strategy || Object.keys(strategy).length === 0) {
        if (!globalTokenCache.length || now - lastCacheUpdate > CACHE_TTL) {
            try {
                globalTokenCache = await (0, tokenUtils_1.fetchDexScreenerTokens)('solana');
                lastCacheUpdate = Date.now();
            }
            catch (e) {
                console.error('[getTokensForUser] Failed to refresh globalTokenCache:', e?.message || e);
            }
        }
        return globalTokenCache;
    }
    // Check per-user cache
    const cached = userTokenCache[userId];
    if (cached && now - cached.ts < CACHE_TTL)
        return cached.tokens;
    // Build extra params from strategy fields (only numeric/boolean filters)
    const extraParams = {};
    try {
        for (const f of tokenUtils_1.STRATEGY_FIELDS) {
            if (!(f.key in strategy))
                continue;
            const v = strategy[f.key];
            if (v === undefined || v === null)
                continue;
            if (f.type === 'number') {
                const n = Number(v);
                if (!isNaN(n) && n !== 0)
                    extraParams[f.key] = String(n);
            }
            else if (f.type === 'boolean') {
                extraParams[f.key] = v ? '1' : '0';
            }
            else {
                extraParams[f.key] = String(v);
            }
        }
    }
    catch (e) {
        console.error('[getTokensForUser] Error building extraParams from strategy', e);
    }
    // If no meaningful params, fall back to global cache
    if (Object.keys(extraParams).length === 0) {
        if (!globalTokenCache.length || now - lastCacheUpdate > CACHE_TTL) {
            try {
                globalTokenCache = await (0, tokenUtils_1.fetchDexScreenerTokens)('solana');
                lastCacheUpdate = Date.now();
            }
            catch (e) {
                console.error('[getTokensForUser] Fallback failed to refresh globalTokenCache:', e?.message || e);
            }
        }
        return globalTokenCache;
    }
    // Try to fetch with user-specific params. If it fails, fall back to global cache.
    try {
        const tokens = await (0, tokenUtils_1.fetchDexScreenerTokens)('solana', extraParams);
        // If strategy references age, apply fast numeric pre-filters (exclude age)
        try {
            const needsAge = Object.keys(strategy).some(k => k.toLowerCase().includes('age'));
            if (needsAge) {
                // Build a shallow strategy copy without age-related fields
                const fastStrategy = {};
                for (const k of Object.keys(strategy)) {
                    if (String(k).toLowerCase().includes('age'))
                        continue;
                    fastStrategy[k] = strategy[k];
                }
                // Use tokenUtils.autoFilterTokens for quick numeric filtering
                const tokenUtils = await Promise.resolve().then(() => __importStar(require('./src/utils/tokenUtils')));
                const prefilteredVerbose = (() => {
                    try {
                        return tokenUtils.autoFilterTokensVerbose(tokens, fastStrategy);
                    }
                    catch {
                        return { passed: tokens, rejected: [] };
                    }
                })();
                const resolvedPrefiltered = Array.isArray(prefilteredVerbose) ? prefilteredVerbose : (prefilteredVerbose && prefilteredVerbose.passed ? prefilteredVerbose.passed : tokens);
                // enrich only top candidates (by liquidity then volume)
                // per-user overrides with env defaults
                const enrichLimit = Number(strategy?.heliusEnrichLimit ?? HELIUS_ENRICH_LIMIT ?? 25);
                const heliusBatchSize = Number(strategy?.heliusBatchSize ?? HELIUS_BATCH_SIZE ?? 8);
                const heliusBatchDelayMs = Number(strategy?.heliusBatchDelayMs ?? HELIUS_BATCH_DELAY_MS ?? 250);
                // sort candidates by liquidity (fallback to volume or marketCap)
                const ranked = resolvedPrefiltered.slice().sort((a, b) => {
                    const la = (a.liquidity || a.liquidityUsd || 0);
                    const lb = (b.liquidity || b.liquidityUsd || 0);
                    if (lb !== la)
                        return lb - la;
                    const va = (a.volume || a.volumeUsd || 0);
                    const vb = (b.volume || b.volumeUsd || 0);
                    return vb - va;
                });
                const toEnrich = ranked.slice(0, enrichLimit);
                const { enrichTokenTimestamps, withTimeout } = await Promise.resolve().then(() => __importStar(require('./src/utils/tokenUtils')));
                try {
                    const timeoutMs = Number(ONCHAIN_FRESHNESS_TIMEOUT_MS || 5000);
                    await withTimeout(enrichTokenTimestamps(toEnrich, { batchSize: heliusBatchSize, delayMs: heliusBatchDelayMs }), timeoutMs, 'getTokens-enrich');
                }
                catch (e) {
                    // Keep a concise log and proceed with un-enriched token list to avoid blocking handlers
                    console.warn('[getTokensForUser] enrichment skipped/timeout:', e?.message || e);
                }
                // Merge enriched timestamps back into tokens list for returned set
                const enrichedMap = new Map(toEnrich.map((t) => [(t.tokenAddress || t.address || t.mint || t.pairAddress), t]));
                for (let i = 0; i < tokens.length; i++) {
                    const key = tokens[i].tokenAddress || tokens[i].address || tokens[i].mint || tokens[i].pairAddress;
                    if (enrichedMap.has(key))
                        tokens[i] = enrichedMap.get(key);
                }
            }
        }
        catch (e) {
            console.error('[getTokensForUser] enrichment error:', e?.message || e);
        }
        userTokenCache[userId] = { tokens, ts: Date.now() };
        return tokens;
    }
    catch (e) {
        console.error('[getTokensForUser] Failed to fetch tokens with extraParams, falling back to global cache:', e?.message || e);
        if (!globalTokenCache.length || now - lastCacheUpdate > CACHE_TTL) {
            try {
                globalTokenCache = await (0, tokenUtils_1.fetchDexScreenerTokens)('solana');
                lastCacheUpdate = Date.now();
            }
            catch (err) {
                console.error('[getTokensForUser] Final fallback failed to refresh globalTokenCache:', err?.message || err);
            }
        }
        return globalTokenCache;
    }
}
// Strategy state machine for interactive setup (single declaration)
const userStrategyStates = {};
// buy/sell handlers will be registered after users are loaded in startup sequence
bot.command('auto_execute', async (ctx) => {
    const userId = String(ctx.from?.id);
    const user = users[userId];
    console.log(`[auto_execute] User: ${userId}`);
    if (!user || !user.strategy || !user.strategy.enabled) {
        await ctx.reply('You must set a strategy first using /strategy');
        return;
    }
    const now = Date.now();
    const tokens = await getTokensForUser(userId, user.strategy);
    await ctx.reply('Executing your strategy on matching tokens...');
    try {
        await (0, autoStrategyExecutor_1.autoExecuteStrategyForUser)(user, tokens, 'buy');
        await ctx.reply('Strategy executed successfully!');
    }
    catch (e) {
        await ctx.reply('Error during auto execution: ' + (0, helpers_1.getErrorMessage)(e));
    }
});
const mainReplyKeyboard = telegraf_1.Markup.keyboard([
    ['💼 Wallet', '⚙️ Strategy'],
    ['📊 Show Tokens', '🤝 Invite Friends']
]).resize();
bot.start(async (ctx) => {
    await ctx.reply('👋 Welcome to the Trading Bot!\nPlease choose an option:', mainReplyKeyboard);
});
bot.hears('💼 Wallet', async (ctx) => {
    const userId = String(ctx.from?.id);
    const user = users[userId];
    console.log(`[💼 Wallet] User: ${userId}`);
    if (user && (0, helpers_1.hasWallet)(user)) {
        const { getSolBalance } = await Promise.resolve().then(() => __importStar(require('./src/getSolBalance')));
        let balance = 0;
        try {
            balance = await getSolBalance(user.wallet);
        }
        catch { }
        await ctx.reply(`💼 Your Wallet:\nAddress: <code>${user.wallet}</code>\nBalance: <b>${balance}</b> SOL`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👁️ Show Private Key', callback_data: 'show_secret' }]
                ]
            }
        });
    }
    else {
        await ctx.reply('❌ No wallet found for this user.', (0, helpers_1.walletKeyboard)());
    }
});
bot.action('show_secret', async (ctx) => {
    console.log(`[show_secret] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    const user = users[userId];
    if (user && (0, helpers_1.hasWallet)(user)) {
        // For security, do not send the private key in chat. Prompt the user to restore or view locally.
        await ctx.reply('🔒 For your safety the private key is not shown in chat. Use /restore_wallet to restore from your key or manage your wallet locally.');
    }
    else {
        await ctx.reply('❌ No wallet found for this user.');
    }
});
bot.hears('⚙️ Strategy', async (ctx) => {
    console.log(`[⚙️ Strategy] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    userStrategyStates[userId] = { step: 0, values: {} };
    await ctx.reply('🚦 Strategy Setup:\nPlease enter the required value for each field. Send "skip" to skip any optional field.');
    const field = tokenUtils_1.STRATEGY_FIELDS[0];
    await ctx.reply(`📝 ${field.label}${field.optional ? ' (optional)' : ''}`);
});
bot.hears('📊 Show Tokens', async (ctx) => {
    console.log(`[📊 Show Tokens] User: ${String(ctx.from?.id)}`);
    ctx.reply('To view tokens matching your strategy, use the /show_token command.');
});
bot.hears('🤝 Invite Friends', async (ctx) => {
    console.log(`[🤝 Invite Friends] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    const inviteLink = `https://t.me/${ctx.me}?start=${userId}`;
    await ctx.reply(`🤝 Share this link to invite your friends:\n${inviteLink}`);
});
bot.command('notify_tokens', async (ctx) => {
    console.log(`[notify_tokens] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    const user = users[userId];
    if (!user || !user.strategy || !user.strategy.enabled) {
        await ctx.reply('❌ You must set a strategy first using /strategy');
        return;
    }
    const now = Date.now();
    const tokens = await getTokensForUser(userId, user.strategy);
    const filteredTokens = await (require('./src/bot/strategy').filterTokensByStrategy(tokens, user.strategy));
    if (!filteredTokens.length) {
        await ctx.reply('No tokens currently match your strategy.');
        return;
    }
    await (0, tokenUtils_1.notifyUsers)(ctx.telegram, { [userId]: user }, filteredTokens);
    await ctx.reply('✅ Notification sent for tokens matching your strategy.');
});
// buy/sell handlers are centralized in src/bot/buySellHandlers.ts via registerBuySellHandlers
bot.command('wallet', async (ctx) => {
    console.log(`[wallet] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    const user = users[userId];
    if (user && (0, helpers_1.hasWallet)(user)) {
        await ctx.reply('� You have a wallet configured. For security the private key is not displayed. Use the inline button "Show Private Key" if absolutely needed, or /restore_wallet to restore from your secret.');
    }
    else {
        await ctx.reply('❌ No wallet found for this user.', (0, helpers_1.walletKeyboard)());
    }
});
bot.command(['create_wallet', 'restore_wallet'], async (ctx) => {
    console.log(`[${ctx.message.text.startsWith('/restore_wallet') ? 'restore_wallet' : 'create_wallet'}] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    let user = users[userId];
    if (!user) {
        user = {};
        users[userId] = user;
    }
    let keypair, secret;
    if (ctx.message.text.startsWith('/restore_wallet')) {
        const parts = ctx.message.text.split(' ');
        if (parts.length < 2) {
            await ctx.reply('❗ Please provide the private key after the command. Example: /restore_wallet <secret>');
            return;
        }
        try {
            keypair = (0, wallet_1.parseKey)(parts[1]);
            secret = (0, wallet_1.exportSecretKey)(keypair);
        }
        catch (e) {
            await ctx.reply('❌ Failed to restore wallet. Invalid key.');
            return;
        }
    }
    else {
        keypair = (0, wallet_1.generateKeypair)();
        secret = (0, wallet_1.exportSecretKey)(keypair);
    }
    user.secret = secret;
    user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
    (0, helpers_1.saveUsers)(users);
    await ctx.reply('✅ Wallet ' + (ctx.message.text.startsWith('/restore_wallet') ? 'restored' : 'created') + ' successfully!\nAddress: <code>' + user.wallet + '</code>\nPrivate key (keep it safe): <code>' + user.secret + '</code>', { parse_mode: 'HTML' });
});
async function notifyAutoSell(user, sellOrder) {
    console.log(`[notifyAutoSell] User: ${user?.id || user?.userId || user?.telegramId}, Token: ${sellOrder.token}, Amount: ${sellOrder.amount}, Status: ${sellOrder.status}`);
    try {
        const chatId = user.id || user.userId || user.telegramId;
        let msg = `✅ Auto-sell order executed:\n`;
        msg += `Token: ${sellOrder.token}\nAmount: ${sellOrder.amount}\nTarget price: ${sellOrder.targetPrice}\n`;
        msg += sellOrder.tx ? `Transaction: ${sellOrder.tx}\n` : '';
        msg += sellOrder.status === 'success' ? 'Executed successfully.' : 'Execution failed.';
        await bot.telegram.sendMessage(chatId, msg);
    }
    catch { }
}
setInterval(async () => {
    console.log(`[monitorAndAutoSellTrades] Interval triggered`);
    if (!users || typeof users !== 'object')
        return;
    for (const userId in users) {
        if (!userId || userId === 'undefined') {
            console.warn('[monitorAndAutoSellTrades] Invalid userId, skipping.');
            continue;
        }
        const user = users[userId];
        const tokensForUser = await getTokensForUser(userId, user?.strategy);
        await (0, strategy_1.monitorAndAutoSellTrades)(user, tokensForUser);
        const sentTokensDir = process.cwd() + '/sent_tokens';
        const userFile = `${sentTokensDir}/${userId}.json`;
        try {
            if (!(await fsp.stat(userFile).catch(() => false)))
                continue;
        }
        catch {
            continue;
        }
        let userTrades = [];
        try {
            const data = await fsp.readFile(userFile, 'utf8');
            userTrades = JSON.parse(data || '[]');
        }
        catch { }
        const executed = userTrades.filter((t) => t.mode === 'sell' && t.status === 'success' && t.auto && !t.notified);
        for (const sellOrder of executed) {
            await notifyAutoSell(user, sellOrder);
            sellOrder.notified = true;
        }
        try {
            await (0, helpers_1.writeJsonFile)(userFile, userTrades);
        }
        catch (e) {
            console.error('[monitorAndAutoSellTrades] Failed to write user trades for', userFile, e);
        }
    }
}, 5 * 60 * 1000);
// ========== Interactive wallet buttons ==========
bot.action('create_wallet', async (ctx) => {
    console.log(`[create_wallet] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    let user = users[userId];
    if (!user) {
        user = {};
        users[userId] = user;
    }
    // Prevent creating a wallet if one already exists
    if (user.secret && user.wallet) {
        await ctx.reply('You already have a wallet! You can view it from the menu.');
        return;
    }
    const keypair = (0, wallet_1.generateKeypair)();
    const secret = (0, wallet_1.exportSecretKey)(keypair);
    user.secret = secret;
    user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
    (0, helpers_1.saveUsers)(users);
    await ctx.reply(`✅ Wallet created successfully!\nAddress: <code>${user.wallet}</code>\nPrivate key (keep it safe): <code>${user.secret}</code>`, { parse_mode: 'HTML' });
});
bot.action('restore_wallet', async (ctx) => {
    console.log(`[restore_wallet] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    restoreStates[userId] = true;
    await ctx.reply('🔑 Please send your wallet private key in a private message now:');
});
bot.on('text', async (ctx, next) => {
    console.log(`[text] User: ${String(ctx.from?.id)}, Message: ${ctx.message.text}`);
    const userId = String(ctx.from?.id);
    // 1) Wallet restore flow
    if (restoreStates[userId]) {
        const secret = ctx.message.text.trim();
        try {
            const keypair = (0, wallet_1.parseKey)(secret);
            let user = users[userId] || {};
            user.secret = (0, wallet_1.exportSecretKey)(keypair);
            user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
            users[userId] = user;
            (0, helpers_1.saveUsers)(users);
            delete restoreStates[userId];
            await ctx.reply(`✅ Wallet restored successfully!\nAddress: <code>${user.wallet}</code>\nPrivate key stored securely.`, { parse_mode: 'HTML' });
        }
        catch {
            await ctx.reply('❌ Failed to restore wallet. Invalid key. Try again or create a new wallet.');
        }
        return;
    }
    // 2) Interactive strategy setup flow
    if (userStrategyStates[userId]) {
        const state = userStrategyStates[userId];
        // Trade settings phase
        if (state.phase === 'tradeSettings') {
            const tradeFields = [
                { key: 'buyAmount', label: 'Buy amount per trade (SOL)', type: 'number' },
                { key: 'sellPercent1', label: 'Sell percent for first target (%)', type: 'number' },
                { key: 'target1', label: 'Profit target 1 (%)', type: 'number' },
                { key: 'sellPercent2', label: 'Sell percent for second target (%)', type: 'number' },
                { key: 'target2', label: 'Profit target 2 (%)', type: 'number' },
                { key: 'stopLoss', label: 'Stop loss (%)', type: 'number' },
                { key: 'maxTrades', label: 'Max concurrent trades', type: 'number' }
            ];
            if (state.step >= tradeFields.length) {
                delete userStrategyStates[userId];
                return;
            }
            const current = tradeFields[state.step];
            let value = ctx.message.text.trim();
            const numValue = Number(value);
            if (isNaN(numValue)) {
                await ctx.reply('❗ Please enter a valid number.');
                return;
            }
            value = numValue;
            if (!state.tradeSettings)
                state.tradeSettings = {};
            state.tradeSettings[current.key] = value;
            state.step++;
            if (state.step < tradeFields.length) {
                await ctx.reply(`📝 ${tradeFields[state.step].label}`);
            }
            else {
                if (!users[userId])
                    users[userId] = {};
                users[userId].strategy = (0, strategyNormalizer_1.normalizeStrategy)({ ...state.values, ...state.tradeSettings, enabled: true });
                (0, helpers_1.saveUsers)(users);
                delete userStrategyStates[userId];
                await ctx.reply('✅ Strategy and trade settings saved successfully! You can now press "📊 Show Tokens" to see matching tokens and trades.');
            }
            return;
        }
        // Main strategy fields phase
        if (state.step >= tokenUtils_1.STRATEGY_FIELDS.length) {
            delete userStrategyStates[userId];
            return;
        }
        const field = tokenUtils_1.STRATEGY_FIELDS[state.step];
        let value = ctx.message.text.trim();
        if (value === 'skip' && field.optional) {
            value = undefined;
        }
        else if (field.type === 'number') {
            const numValue = Number(value);
            if (isNaN(numValue)) {
                await ctx.reply('❗ Please enter a valid number.');
                return;
            }
            value = numValue;
        }
        state.values[field.key] = value;
        state.step++;
        if (state.step < tokenUtils_1.STRATEGY_FIELDS.length) {
            const nextField = tokenUtils_1.STRATEGY_FIELDS[state.step];
            await ctx.reply(`📝 ${nextField.label}${nextField.optional ? ' (optional)' : ''}`);
        }
        else {
            state.step = 0;
            state.phase = 'tradeSettings';
            state.tradeSettings = {};
            await ctx.reply('⚙️ Trade settings:\nPlease enter the buy amount per trade (SOL):');
        }
        return;
    }
    if (typeof next === 'function')
        return next();
});
// Note: strategy state handlers are registered earlier to avoid duplicate registrations
bot.command('show_token', async (ctx) => {
    console.log(`[show_token] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    const user = users[userId];
    if (!user || !user.strategy || !user.strategy.enabled) {
        await ctx.reply('❌ You must set a strategy first using /strategy');
        return;
    }
    const tokens = await getTokensForUser(userId, user.strategy);
    const filteredTokens = await (require('./src/bot/strategy').filterTokensByStrategy(tokens, user.strategy));
    const maxTrades = user.strategy.maxTrades && user.strategy.maxTrades > 0 ? user.strategy.maxTrades : 5;
    const tokensToTrade = filteredTokens.slice(0, maxTrades);
    if (!tokensToTrade.length) {
        await ctx.reply('No tokens currently match your strategy.');
        return;
    }
    await ctx.reply(`🔎 Found <b>${tokensToTrade.length}</b> tokens matching your strategy${filteredTokens.length > maxTrades ? ` (showing first ${maxTrades})` : ''}.\nExecuting auto-buy and auto-sell setup...`, { parse_mode: 'HTML' });
    let buyResults = [];
    let successCount = 0, failCount = 0;
    for (const token of tokensToTrade) {
        const tokenAddress = token.tokenAddress || token.address || token.mint || token.pairAddress;
        const buyAmount = user.strategy.buyAmount || 0.01;
        const name = token.name || token.symbol || tokenAddress;
        const price = token.priceUsd || token.price || '-';
        const dexUrl = token.url || (token.pairAddress ? `https://dexscreener.com/solana/${token.pairAddress}` : '');
        console.log(`[show_token] Attempting buy: User: ${userId}, Token: ${tokenAddress}, Amount: ${buyAmount}`);
        try {
            const buyResult = await (0, tradeSources_1.unifiedBuy)(tokenAddress, buyAmount, user.secret);
            console.log(`[show_token] Buy result:`, buyResult);
            if (buyResult && buyResult.tx) {
                successCount++;
                // سجل العملية في التاريخ
                const entry = `AutoShowTokenBuy: ${tokenAddress} | Amount: ${buyAmount} SOL | Source: unifiedBuy | Tx: ${buyResult.tx}`;
                user.history = user.history || [];
                user.history.push(entry);
                (0, helpers_1.limitHistory)(user);
                (0, helpers_1.saveUsers)(users);
                // سجل أمر بيع تلقائي
                const targetPercent = user.strategy.targetPercent || 10;
                try {
                    await (0, strategy_1.registerBuyWithTarget)(user, { address: tokenAddress, price }, buyResult, targetPercent);
                }
                catch (e) {
                    console.error('registerBuyWithTarget error:', e);
                }
                buyResults.push(`🟢 <b>${name}</b> (<code>${tokenAddress}</code>)\nPrice: <b>${price}</b> USD\nAmount: <b>${buyAmount}</b> SOL\nTx: <a href='https://solscan.io/tx/${buyResult.tx}'>${buyResult.tx}</a>\n<a href='${dexUrl}'>DexScreener</a> | <a href='https://solscan.io/token/${tokenAddress}'>Solscan</a>\n------------------------------`);
            }
            else {
                failCount++;
                console.log(`[show_token] Buy failed for token: ${tokenAddress}`);
                buyResults.push(`🔴 <b>${name}</b> (<code>${tokenAddress}</code>)\n❌ Failed to buy.`);
            }
        }
        catch (e) {
            failCount++;
            console.log(`[show_token] Error during buy for token: ${tokenAddress}`, e);
            buyResults.push(`🔴 <b>${name}</b> (<code>${tokenAddress}</code>)\n❌ Error: ${(0, helpers_1.getErrorMessage)(e)}`);
        }
    }
    let summary = `<b>Auto Buy Summary</b>\n------------------------------\n✅ Success: <b>${successCount}</b>\n❌ Failed: <b>${failCount}</b>\n------------------------------`;
    await ctx.reply(summary + '\n' + buyResults.join('\n'), { parse_mode: 'HTML' });
    // Handle Buy/Sell actions from show_token
    bot.action(/showtoken_buy_(.+)/, async (ctx) => {
        const userId = String(ctx.from?.id);
        const user = users[userId];
        const tokenAddress = ctx.match[1];
        console.log(`[showtoken_buy] User: ${userId}, Token: ${tokenAddress}`);
        if (!user || !(0, helpers_1.hasWallet)(user) || !user.strategy || !user.strategy.enabled) {
            await ctx.reply('❌ No active strategy or wallet found.');
            return;
        }
        try {
            const amount = user.strategy.buyAmount || 0.01;
            await ctx.reply(`🛒 Buying token: <code>${tokenAddress}</code> with amount: <b>${amount}</b> SOL ...`, { parse_mode: 'HTML' });
            const result = await (0, tradeSources_1.unifiedBuy)(tokenAddress, amount, user.secret);
            if (result && result.tx) {
                const entry = `ShowTokenBuy: ${tokenAddress} | Amount: ${amount} SOL | Source: unifiedBuy | Tx: ${result.tx}`;
                user.history = user.history || [];
                user.history.push(entry);
                (0, helpers_1.limitHistory)(user);
                (0, helpers_1.saveUsers)(users);
                await ctx.reply(`Token bought successfully! Tx: ${result.tx}`);
            }
            else {
                await ctx.reply('Buy failed: Transaction was not completed.');
            }
        }
        catch (e) {
            await ctx.reply('❌ Error during buy: ' + (0, helpers_1.getErrorMessage)(e));
            console.error('showtoken buy error:', e);
        }
    });
    bot.action(/showtoken_sell_(.+)/, async (ctx) => {
        const userId = String(ctx.from?.id);
        const user = users[userId];
        const tokenAddress = ctx.match[1];
        console.log(`[showtoken_sell] User: ${userId}, Token: ${tokenAddress}`);
        if (!user || !(0, helpers_1.hasWallet)(user) || !user.strategy || !user.strategy.enabled) {
            await ctx.reply('❌ No active strategy or wallet found.');
            return;
        }
        try {
            const sellPercent = user.strategy.sellPercent1 || 100;
            // For demo, assume full balance = buyAmount
            const balance = user.strategy.buyAmount || 0.01;
            const amount = (balance * sellPercent) / 100;
            await ctx.reply(`🔻 Selling token: <code>${tokenAddress}</code> with <b>${sellPercent}%</b> of your balance (${balance}) ...`, { parse_mode: 'HTML' });
            const result = await (0, tradeSources_1.unifiedSell)(tokenAddress, amount, user.secret);
            if (result && result.tx) {
                const entry = `ShowTokenSell: ${tokenAddress} | Amount: ${amount} | Source: unifiedSell | Tx: ${result.tx}`;
                user.history = user.history || [];
                user.history.push(entry);
                (0, helpers_1.limitHistory)(user);
                (0, helpers_1.saveUsers)(users);
                await ctx.reply(`Token sold successfully! Tx: ${result.tx}`);
            }
            else {
                await ctx.reply('Sell failed: Transaction was not completed.');
            }
        }
        catch (e) {
            await ctx.reply('❌ Error during sell: ' + (0, helpers_1.getErrorMessage)(e));
            console.error('showtoken sell error:', e);
        }
    });
});
// =================== Bot Launch ===================
console.log('--- About to launch bot ---');
(async () => {
    try {
        // Load users from disk before registering handlers and launching
        try {
            users = await (0, helpers_1.loadUsers)();
            console.log('--- Users loaded (async) ---');
            try {
                (0, enrichQueue_1.startEnrichQueue)(bot.telegram, users, { intervalMs: 2000 });
            }
            catch (err) {
                console.warn('Failed to start enrich queue early:', err);
            }
        }
        catch (e) {
            console.error('Failed to load users async:', e);
            users = (0, helpers_1.loadUsersSync)();
        }
        // Register centralized buy/sell handlers now that users are loaded
        try {
            (0, buySellHandlers_1.registerBuySellHandlers)(bot, users, boughtTokens);
        }
        catch (e) {
            console.error('Failed to register buy/sell handlers:', e);
        }
        await bot.launch();
        console.log('✅ Bot launched successfully (polling)');
        try {
            // Start fast token fetcher to prioritize some users (1s polling)
            const fast = (0, fastTokenFetcher_1.startFastTokenFetcher)(users, bot.telegram, { intervalMs: 1000 });
            // Optionally keep a reference: globalThis.__fastFetcher = fast;
            // Caller may call fast.stop() to stop it.
            try {
                // Start background enrich queue conservatively
                (0, enrichQueue_1.startEnrichQueue)(bot.telegram, users, { intervalMs: 2000 });
            }
            catch (err) {
                console.warn('Failed to start enrich queue:', err);
            }
        }
        catch (e) {
            console.warn('Failed to start fast token fetcher:', e);
        }
    }
    catch (err) {
        if (err?.response?.error_code === 409) {
            console.error('❌ Bot launch failed: Conflict 409. Make sure the bot is not running elsewhere or stop all other sessions.');
            process.exit(1);
        }
        else {
            console.error('❌ Bot launch failed:', err);
            process.exit(1);
        }
    }
})();
console.log('--- End of file reached ---');
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
// Lightweight show_token handler: enqueue background job and return immediately
bot.command('show_token', async (ctx) => {
    console.log(`[show_token] User: ${String(ctx.from?.id)}`);
    const userId = String(ctx.from?.id);
    const user = users[userId];
    if (!user || !user.strategy || !user.strategy.enabled) {
        await ctx.reply('❌ You must set a strategy first using /strategy');
        return;
    }
    try {
        await (0, enrichQueue_1.enqueueEnrichJob)({ userId, strategy: user.strategy, requestTs: Date.now(), chatId: ctx.chat?.id });
        await ctx.reply('🔔 Your request is queued for background processing. You will be notified if matching tokens are found (this avoids long waits and provider rate limits).');
    }
    catch (e) {
        console.error('[show_token] enqueue error:', e);
        await ctx.reply('❌ Failed to enqueue background job. Try again later.');
    }
});
