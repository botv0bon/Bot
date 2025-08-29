// =================== Imports ===================
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
const fsp = fs.promises;
import { Telegraf, Markup } from 'telegraf';
import { loadUsers, loadUsersSync, saveUsers, walletKeyboard, getErrorMessage, limitHistory, hasWallet, writeJsonFile } from './src/bot/helpers';
import { unifiedBuy, unifiedSell } from './src/tradeSources';
import { filterTokensByStrategy, registerBuyWithTarget, monitorAndAutoSellTrades } from './src/bot/strategy';
import { autoExecuteStrategyForUser } from './src/autoStrategyExecutor';
import { STRATEGY_FIELDS, notifyUsers, fetchDexScreenerTokens, fetchDexScreenerProfiles, fetchDexScreenerPairsForSolanaTokens, withTimeout } from './src/utils/tokenUtils';
import { buildPreviewMessage } from './src/utils/tokenUtils';
import { enqueueEnrichJob, startEnrichQueue } from './src/bot/enrichQueue';
import { registerBuySellHandlers } from './src/bot/buySellHandlers';
import { normalizeStrategy } from './src/utils/strategyNormalizer';
import { startFastTokenFetcher } from './src/fastTokenFetcher';
import { generateKeypair, exportSecretKey, parseKey } from './src/wallet';

// Install a small console filter to suppress noisy 429/retry messages coming from HTTP libs
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
const _origLog = console.log.bind(console);
const _filterRegex = /(Server responded with 429 Too Many Requests|Retrying after|Too Many Requests|entering cooldown)/i;
console.warn = (...args: any[]) => {
  try {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (_filterRegex.test(s)) return; // drop noisy retry/429 lines
  } catch (e) {}
  _origWarn(...args);
};
console.error = (...args: any[]) => {
  try {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (_filterRegex.test(s)) return;
  } catch (e) {}
  _origError(...args);
};
console.log = (...args: any[]) => {
  try {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (_filterRegex.test(s)) return;
  } catch (e) {}
  _origLog(...args);
};

console.log('--- Bot starting: Imports loaded ---');

dotenv.config();

// Configuration values (can be overridden via .env)
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
const bot = new Telegraf(TELEGRAM_TOKEN);
console.log('--- Telegraf instance created ---');
let users: Record<string, any> = {};
console.log('--- Users placeholder created ---');
let globalTokenCache: any[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 1000 * 60 * 2;
let boughtTokens: Record<string, Set<string>> = {};
const restoreStates: Record<string, boolean> = {};

// Per-user token cache to allow fetching tailored token lists per-user strategy
const userTokenCache: Record<string, { tokens: any[]; ts: number }> = {};

async function getTokensForUser(userId: string, strategy: Record<string, any> | undefined) {
  const now = Date.now();
  // If user has no strategy or empty filters, reuse global cache for efficiency
  if (!strategy || Object.keys(strategy).length === 0) {
    if (!globalTokenCache.length || now - lastCacheUpdate > CACHE_TTL) {
      try {
        globalTokenCache = await fetchDexScreenerTokens('solana');
        lastCacheUpdate = Date.now();
      } catch (e: any) {
        console.error('[getTokensForUser] Failed to refresh globalTokenCache:', e?.message || e);
      }
    }
    return globalTokenCache;
  }

  // Check per-user cache
  const cached = userTokenCache[userId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.tokens;

  // Build extra params from strategy fields (only numeric/boolean filters)
  const extraParams: Record<string, string> = {};
  try {
    for (const f of STRATEGY_FIELDS) {
      if (!(f.key in strategy)) continue;
      const v = strategy[f.key];
      if (v === undefined || v === null) continue;
      if (f.type === 'number') {
        const n = Number(v);
        if (!isNaN(n) && n !== 0) extraParams[f.key] = String(n);
      } else if (f.type === 'boolean') {
        extraParams[f.key] = v ? '1' : '0';
      } else {
        extraParams[f.key] = String(v);
      }
    }
  } catch (e) {
    console.error('[getTokensForUser] Error building extraParams from strategy', e);
  }

  // If no meaningful params, fall back to global cache
  if (Object.keys(extraParams).length === 0) {
    if (!globalTokenCache.length || now - lastCacheUpdate > CACHE_TTL) {
      try {
        globalTokenCache = await fetchDexScreenerTokens('solana');
        lastCacheUpdate = Date.now();
      } catch (e: any) {
        console.error('[getTokensForUser] Fallback failed to refresh globalTokenCache:', e?.message || e);
      }
    }
    return globalTokenCache;
  }

  // Try to fetch with user-specific params. If it fails, fall back to global cache.
  try {
    const tokens = await fetchDexScreenerTokens('solana', extraParams);
    // If strategy references age, apply fast numeric pre-filters (exclude age)
    try {
      const needsAge = Object.keys(strategy).some(k => k.toLowerCase().includes('age'));
      if (needsAge) {
        // Build a shallow strategy copy without age-related fields
        const fastStrategy: Record<string, any> = {};
        for (const k of Object.keys(strategy)) {
          if (String(k).toLowerCase().includes('age')) continue;
          fastStrategy[k] = strategy[k];
        }
        // Use tokenUtils.autoFilterTokens for quick numeric filtering
        const tokenUtils = await import('./src/utils/tokenUtils');
        const prefilteredVerbose = (() => {
          try { return tokenUtils.autoFilterTokensVerbose(tokens, fastStrategy); } catch { return { passed: tokens, rejected: [] }; }
        })();
        const resolvedPrefiltered = Array.isArray(prefilteredVerbose) ? prefilteredVerbose : (prefilteredVerbose && prefilteredVerbose.passed ? prefilteredVerbose.passed : tokens);
        // enrich only top candidates (by liquidity then volume)
  // per-user overrides with env defaults
  const enrichLimit = Number(strategy?.heliusEnrichLimit ?? HELIUS_ENRICH_LIMIT ?? 25);
  const heliusBatchSize = Number(strategy?.heliusBatchSize ?? HELIUS_BATCH_SIZE ?? 8);
  const heliusBatchDelayMs = Number(strategy?.heliusBatchDelayMs ?? HELIUS_BATCH_DELAY_MS ?? 250);
        // sort candidates by liquidity (fallback to volume or marketCap)
        const ranked = resolvedPrefiltered.slice().sort((a: any, b: any) => {
          const la = (a.liquidity || a.liquidityUsd || 0) as number;
          const lb = (b.liquidity || b.liquidityUsd || 0) as number;
          if (lb !== la) return lb - la;
          const va = (a.volume || a.volumeUsd || 0) as number;
          const vb = (b.volume || b.volumeUsd || 0) as number;
          return vb - va;
        });
        const toEnrich = ranked.slice(0, enrichLimit);
        const { enrichTokenTimestamps, withTimeout } = await import('./src/utils/tokenUtils');
        try {
          const timeoutMs = Number(ONCHAIN_FRESHNESS_TIMEOUT_MS || 5000);
          await withTimeout(enrichTokenTimestamps(toEnrich, { batchSize: heliusBatchSize, delayMs: heliusBatchDelayMs }), timeoutMs, 'getTokens-enrich');
        } catch (e: any) {
          // Keep a concise log and proceed with un-enriched token list to avoid blocking handlers
          console.warn('[getTokensForUser] enrichment skipped/timeout:', e?.message || e);
        }
        // Merge enriched timestamps back into tokens list for returned set
        const enrichedMap = new Map(toEnrich.map((t: any) => [(t.tokenAddress || t.address || t.mint || t.pairAddress), t]));
        for (let i = 0; i < tokens.length; i++) {
          const key = tokens[i].tokenAddress || tokens[i].address || tokens[i].mint || tokens[i].pairAddress;
          if (enrichedMap.has(key)) tokens[i] = enrichedMap.get(key);
        }
      }
    } catch (e) {
      console.error('[getTokensForUser] enrichment error:', e?.message || e);
    }
    userTokenCache[userId] = { tokens, ts: Date.now() };
    return tokens;
  } catch (e: any) {
    console.error('[getTokensForUser] Failed to fetch tokens with extraParams, falling back to global cache:', e?.message || e);
    if (!globalTokenCache.length || now - lastCacheUpdate > CACHE_TTL) {
      try {
        globalTokenCache = await fetchDexScreenerTokens('solana');
        lastCacheUpdate = Date.now();
      } catch (err: any) {
        console.error('[getTokensForUser] Final fallback failed to refresh globalTokenCache:', err?.message || err);
      }
    }
    return globalTokenCache;
  }
}

// Strategy state machine for interactive setup (single declaration)
const userStrategyStates: Record<string, { step: number, values: Record<string, any>, phase?: string, tradeSettings?: Record<string, any> }> = {};

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
    await autoExecuteStrategyForUser(user, tokens, 'buy');
    await ctx.reply('Strategy executed successfully!');
  } catch (e: any) {
    await ctx.reply('Error during auto execution: ' + getErrorMessage(e));
  }
});

const mainReplyKeyboard = Markup.keyboard([
  ['💼 Wallet', '⚙️ Strategy'],
  ['📊 Show Tokens', '🤝 Invite Friends']
]).resize();

bot.start(async (ctx) => {
  await ctx.reply(
    '👋 Welcome to the Trading Bot!\nPlease choose an option:',
    mainReplyKeyboard
  );
});

bot.hears('💼 Wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  console.log(`[💼 Wallet] User: ${userId}`);
  if (user && hasWallet(user)) {
    const { getSolBalance } = await import('./src/getSolBalance');
    let balance = 0;
    try {
      balance = await getSolBalance(user.wallet);
    } catch {}
    await ctx.reply(
    `💼 Your Wallet:\nAddress: <code>${user.wallet}</code>\nBalance: <b>${balance}</b> SOL`,
      ({
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [ { text: '👁️ Show Private Key', callback_data: 'show_secret' } ]
          ]
        }
      } as any)
    );
  } else {
    await ctx.reply('❌ No wallet found for this user.', walletKeyboard());
  }
});

bot.action('show_secret', async (ctx) => {
  console.log(`[show_secret] User: ${String(ctx.from?.id)}`);
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (user && hasWallet(user)) {
    // For security, do not send the private key in chat. Prompt the user to restore or view locally.
    await ctx.reply('🔒 For your safety the private key is not shown in chat. Use /restore_wallet to restore from your key or manage your wallet locally.');
  } else {
    await ctx.reply('❌ No wallet found for this user.');
  }
});

bot.hears('⚙️ Strategy', async (ctx) => {
  console.log(`[⚙️ Strategy] User: ${String(ctx.from?.id)}`);
  const userId = String(ctx.from?.id);
  userStrategyStates[userId] = { step: 0, values: {} };
  await ctx.reply('🚦 Strategy Setup:\nPlease enter the required value for each field. Send "skip" to skip any optional field.');
  const field = STRATEGY_FIELDS[0];
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
  const filteredTokens = await (require('./src/bot/strategy').filterTokensByStrategy(tokens, user.strategy, { preserveSources: true }));
  if (!filteredTokens.length) {
    await ctx.reply('No tokens currently match your strategy.');
    return;
  }
  await notifyUsers(ctx.telegram, { [userId]: user }, filteredTokens);
  await ctx.reply('✅ Notification sent for tokens matching your strategy.');
});



// buy/sell handlers are centralized in src/bot/buySellHandlers.ts via registerBuySellHandlers


bot.command('wallet', async (ctx) => {
  console.log(`[wallet] User: ${String(ctx.from?.id)}`);
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (user && hasWallet(user)) {
  await ctx.reply('� You have a wallet configured. For security the private key is not displayed. Use the inline button "Show Private Key" if absolutely needed, or /restore_wallet to restore from your secret.');
  } else {
    await ctx.reply('❌ No wallet found for this user.', walletKeyboard());
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
      keypair = parseKey(parts[1]);
      secret = exportSecretKey(keypair);
    } catch (e) {
      await ctx.reply('❌ Failed to restore wallet. Invalid key.');
      return;
    }
  } else {
    keypair = generateKeypair();
    secret = exportSecretKey(keypair);
  }
  user.secret = secret;
  user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
  saveUsers(users);
  await ctx.reply('✅ Wallet ' + (ctx.message.text.startsWith('/restore_wallet') ? 'restored' : 'created') + ' successfully!\nAddress: <code>' + user.wallet + '</code>\nPrivate key (keep it safe): <code>' + user.secret + '</code>', { parse_mode: 'HTML' });
});


async function notifyAutoSell(user: any, sellOrder: any) {
  console.log(`[notifyAutoSell] User: ${user?.id || user?.userId || user?.telegramId}, Token: ${sellOrder.token}, Amount: ${sellOrder.amount}, Status: ${sellOrder.status}`);
  try {
    const chatId = user.id || user.userId || user.telegramId;
    let msg = `✅ Auto-sell order executed:\n`;
    msg += `Token: ${sellOrder.token}\nAmount: ${sellOrder.amount}\nTarget price: ${sellOrder.targetPrice}\n`;
    msg += sellOrder.tx ? `Transaction: ${sellOrder.tx}\n` : '';
    msg += sellOrder.status === 'success' ? 'Executed successfully.' : 'Execution failed.';
    await bot.telegram.sendMessage(chatId, msg);
  } catch {}
}

setInterval(async () => {
  console.log(`[monitorAndAutoSellTrades] Interval triggered`);
  if (!users || typeof users !== 'object') return;
  for (const userId in users) {
    if (!userId || userId === 'undefined') {
      console.warn('[monitorAndAutoSellTrades] Invalid userId, skipping.');
      continue;
    }
  const user = users[userId];
  const tokensForUser = await getTokensForUser(userId, user?.strategy);
  await monitorAndAutoSellTrades(user, tokensForUser);
    const sentTokensDir = process.cwd() + '/sent_tokens';
    const userFile = `${sentTokensDir}/${userId}.json`;
    try {
      if (!(await fsp.stat(userFile).catch(() => false))) continue;
    } catch {
      continue;
    }
    let userTrades: any[] = [];
    try {
      const data = await fsp.readFile(userFile, 'utf8');
      userTrades = JSON.parse(data || '[]');
    } catch {}
    const executed = userTrades.filter((t: any) => t.mode === 'sell' && t.status === 'success' && t.auto && !t.notified);
    for (const sellOrder of executed) {
      await notifyAutoSell(user, sellOrder);
      (sellOrder as any).notified = true;
    }
    try {
      await writeJsonFile(userFile, userTrades);
    } catch (e) {
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
  const keypair = generateKeypair();
  const secret = exportSecretKey(keypair);
  user.secret = secret;
  user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
  saveUsers(users);
  await ctx.reply(`✅ Wallet created successfully!\nAddress: <code>${user.wallet}</code>\nPrivate key (keep it safe): <code>${user.secret}</code>`, ({ parse_mode: 'HTML' } as any));
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
      const keypair = parseKey(secret);
      let user = users[userId] || {};
      user.secret = exportSecretKey(keypair);
      user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
      users[userId] = user;
      saveUsers(users);
      delete restoreStates[userId];

  await ctx.reply(`✅ Wallet restored successfully!\nAddress: <code>${user.wallet}</code>\nPrivate key stored securely.`, ({ parse_mode: 'HTML' } as any));
    } catch {
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
      let value: any = ctx.message.text.trim();
      const numValue = Number(value);
      if (isNaN(numValue)) {
        await ctx.reply('❗ Please enter a valid number.');
        return;
      }
      value = numValue;
      if (!state.tradeSettings) state.tradeSettings = {};
      state.tradeSettings[current.key] = value;
      state.step++;
      if (state.step < tradeFields.length) {
        await ctx.reply(`📝 ${tradeFields[state.step].label}`);
      } else {
        if (!users[userId]) users[userId] = {};
        users[userId].strategy = normalizeStrategy({ ...state.values, ...state.tradeSettings, enabled: true });
        saveUsers(users);
        delete userStrategyStates[userId];
        await ctx.reply('✅ Strategy and trade settings saved successfully! You can now press "📊 Show Tokens" to see matching tokens and trades.');
      }
      return;
    }

    // Main strategy fields phase
    if (state.step >= STRATEGY_FIELDS.length) {
      delete userStrategyStates[userId];
      return;
    }
    const field = STRATEGY_FIELDS[state.step];
    let value: any = ctx.message.text.trim();
    if (value === 'skip' && field.optional) {
      value = undefined;
    } else if (field.type === 'number') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        await ctx.reply('❗ Please enter a valid number.');
        return;
      }
      value = numValue;
    }
    state.values[field.key] = value;
    state.step++;
    if (state.step < STRATEGY_FIELDS.length) {
      const nextField = STRATEGY_FIELDS[state.step];
      await ctx.reply(`📝 ${nextField.label}${nextField.optional ? ' (optional)' : ''}`);
    } else {
      state.step = 0;
      state.phase = 'tradeSettings';
      state.tradeSettings = {};
      await ctx.reply('⚙️ Trade settings:\nPlease enter the buy amount per trade (SOL):');
    }
    return;
  }

  if (typeof next === 'function') return next();
});

  // Note: strategy state handlers are registered earlier to avoid duplicate registrations


// =================== Bot Launch ===================
console.log('--- About to launch bot ---');
(async () => {
  try {
    // Load users from disk before registering handlers and launching
    try {
      users = await loadUsers();
      console.log('--- Users loaded (async) ---');
      try { startEnrichQueue(bot.telegram, users, { intervalMs: 2000 }); } catch (err) { console.warn('Failed to start enrich queue early:', err); }

      // Start background notification pump early so it runs even if bot.launch hangs.
      try {
        const startNotificationPump = async () => {
          const outDir = path.join(process.cwd(), 'out');
          const notifFile = path.join(outDir, 'notifications.json');
          const notifDir = path.join(outDir, 'notifications');
          try { await fsp.mkdir(outDir, { recursive: true }); } catch (e) {}
          try { await fsp.mkdir(notifDir, { recursive: true }); } catch (e) {}
          console.log('[notificationPump] notifDir path:', notifDir, 'legacy file:', notifFile);
          // suppression map: userId -> Map(addr -> lastSentTs)
          const sentNotifications: Record<string, Map<string, number>> = {};
          // For testing defaults, use 1 minute unless overridden in env
          const suppressionMinutes = Number(process.env.NOTIF_SUPPRESSION_MINUTES ?? 1);
          const suppressionMs = Math.max(0, suppressionMinutes) * 60 * 1000;
          async function collectNotificationsFromRedis(){
            const out: any[] = [];
            if(!process.env.REDIS_URL) return out;
            try{
              const IORedis = require('ioredis');
              const r = new IORedis(process.env.REDIS_URL);
              while(true){
                const item = await r.rpop('notifications');
                if(!item) break;
                try{ out.push(JSON.parse(item)); } catch(e) { /* ignore parse errors */ }
              }
              r.disconnect();
            }catch(e){ console.warn('[notificationPump] redis collect failed', e?.message||e); }
            return out;
          }
          async function collectNotificationsFromFiles(){
            const out: any[] = [];
            try{
              const files = await fsp.readdir(notifDir).catch(()=>[]);
              // process files in time order
              files.sort();
              for(const fname of files){
                const p = path.join(notifDir, fname);
                try{
                  const raw = await fsp.readFile(p, 'utf8').catch(()=>null);
                  if(!raw) { try{ await fsp.unlink(p).catch(()=>{}); } catch(e){}; continue; }
                  try{ const obj = JSON.parse(raw); if(obj) out.push(obj); } catch(e){}
                  try{ await fsp.unlink(p).catch(()=>{}); } catch(e){}
                }catch(e){}
              }
            }catch(e){ /* ignore */ }
            return out;
          }
          async function pumpOnce(){
            try{
              console.log('[notificationPump] pumpOnce triggered');
              let arr: any[] = [];
              // 1) collect from Redis (if available)
              try{ const fromRedis = await collectNotificationsFromRedis(); if(Array.isArray(fromRedis) && fromRedis.length) arr = arr.concat(fromRedis); } catch(e){}
              // 2) collect from append-only files
              try{ const fromFiles = await collectNotificationsFromFiles(); if(Array.isArray(fromFiles) && fromFiles.length) arr = arr.concat(fromFiles); } catch(e){}
              // 3) legacy file fallback (notifications.json)
              if(arr.length === 0){
                try{
                  const raw = await fsp.readFile(notifFile, 'utf8').catch(()=>null);
                  if(raw){ try{ const legacy = JSON.parse(raw||'[]'); if(Array.isArray(legacy) && legacy.length) arr = arr.concat(legacy); } catch(e){} }
                }catch(e){}
              }
              if(!Array.isArray(arr) || arr.length===0) { console.log('[notificationPump] no notifications found'); return; }
              console.log('[notificationPump] collected', arr.length, 'notification(s)');
              // group by user
              const byUser: Record<string, any[]> = {};
              for(const n of arr){ if(!n || !n.user) continue; if(!byUser[n.user]) byUser[n.user]=[]; byUser[n.user].push(n); }
              // process per user
              for(const uid of Object.keys(byUser)){
                try{
                  const user = users[uid]; if(!user || !user.strategy || user.strategy.enabled===false) continue;
                  const maxTrades = Number(user.strategy?.maxTrades || 3);
                  const items = byUser[uid].slice(0, maxTrades);
                  // convert matched addresses to token objects; use listener matches as authoritative
                  const addrs = [].concat(...items.map(it => it.matched || it.matchAddrs || []));
                  const uniq = Array.from(new Set(addrs)).slice(0, maxTrades);
                  let tokens: any[] = uniq.map(a=>({ tokenAddress: a, address: a, mint: a }));
                  // Enrich each address individually via DexScreener (best-effort). Do NOT drop tokens lacking Dex data.
                  try{
                    for (let i = 0; i < tokens.length; i++){
                      const t = tokens[i];
                      const addr = String(t.tokenAddress || t.address || t.mint || '');
                      try{
                        // Try token profile first
                        const profiles = await fetchDexScreenerProfiles('solana', { tokenAddress: addr });
                        if (Array.isArray(profiles) && profiles.length > 0) {
                          tokens[i] = { ...t, ...profiles[0] };
                          continue;
                        }
                        // Fallback: try pairs API to get market data
                        const pairs = await fetchDexScreenerPairsForSolanaTokens([addr]).catch(() => []);
                        if (Array.isArray(pairs) && pairs.length > 0) {
                          const p = pairs[0];
                          const enriched: any = { ...t };
                          if (p.priceUsd || p.price) enriched.priceUsd = p.priceUsd || p.price;
                          enriched.pairAddress = p.pairAddress || p.pair_address || p.pairId || p.pairId || enriched.pairAddress;
                          enriched.url = enriched.url || (enriched.pairAddress ? `https://dexscreener.com/solana/${enriched.pairAddress}` : undefined) || enriched.url;
                          tokens[i] = enriched;
                        }
                      }catch(e){ /* per-address enrichment failed - keep original token object */ }
                    }
                  }catch(e){ /* ignore top-level dex failures */ }
                  // Send up to maxTrades preview messages
                          // prepare sentNotifications map for user
                          if(!sentNotifications[uid]) sentNotifications[uid] = new Map();
                          // optional Redis client for persistent suppression
                          let __redisClient: any = null;
                          async function getRedisClient(){
                            if(__redisClient) return __redisClient;
                            if(!process.env.REDIS_URL) return null;
                            try{ const IORedis = require('ioredis'); __redisClient = new IORedis(process.env.REDIS_URL); return __redisClient; }catch(e){ return null; }
                          }
                          // aggregate tokens for this user into a single message with inline buttons
                          const finalTokens = [];
                          for(const tok of tokens.slice(0, maxTrades)){
                            try{
                              const addr = tok.tokenAddress || tok.address || tok.mint || '';
                              const lastMap = sentNotifications[uid];
                              let suppressed = false;
                              try{ const rc = await getRedisClient(); if(rc){ const key = `sent:${uid}:${addr}`; const v = await rc.get(key).catch(()=>null); if(v) suppressed = true; } }catch(e){}
                              const last = lastMap.get(addr) || 0;
                              if(!suppressed && suppressionMs > 0 && (Date.now() - last) < suppressionMs) suppressed = true;
                              if(suppressed) { console.log(`[notificationPump] skipping ${addr} for user ${uid} (suppressed)`); continue; }
                              finalTokens.push(tok);
                            }catch(e){ }
                          }
                          if(finalTokens.length === 0) continue;
                          try{
                            // build aggregated message
                            const lines = finalTokens.map(t => {
                              const title = (t.name || t.symbol) ? `${t.name || ''}${t.symbol ? ' ('+t.symbol+')' : ''}` : t.tokenAddress.slice(0,8);
                              const price = t.priceUsd ? `${Number(t.priceUsd).toFixed(4)} USD` : 'N/A';
                              const liq = t.liquidityUsd ? `${Math.round(Number(t.liquidityUsd)).toLocaleString()} USD` : 'N/A';
                              const shortSig = (t.sourceSignature||'').substring(0,8);
                              const dex = t.url || (t.pairAddress ? `https://dexscreener.com/solana/${t.pairAddress}` : '');
                              return `• <b>${title}</b> <code>${t.tokenAddress}</code>\n  السعر: ${price} | سيولة: ${liq}\n  مصدر: ${t.sourceProgram || 'listener'} | <code>${shortSig}</code>${dex? '\n  🔗 '+dex : ''}`;
                            }).join('\n\n');
                            const keyboard = { inline_keyboard: [ finalTokens.slice(0,5).map(t=>({ text: `${t.symbol||t.name||t.tokenAddress.slice(0,6)}`, callback_data: `view|${uid}|${t.tokenAddress}` })), [{ text: 'إيقاف الإشعارات لهذه الإستراتيجية', callback_data: `mute|${uid}|strategy` }] ] };
                            const chatId = uid;
                            const aggMsg = `🔔 <b>نتائج استراتيجيتك (${finalTokens.length})</b>\n\n${lines}`;
                            await (bot.telegram as any).sendMessage(chatId, aggMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                            // mark suppression for sent tokens
                            const rc = await getRedisClient();
                            for(const t of finalTokens){ const a = t.tokenAddress || t.address || t.mint || ''; sentNotifications[uid].set(a, Date.now()); try{ if(rc && suppressionMs>0){ const key = `sent:${uid}:${a}`; const ex = Math.max(1, Math.round(suppressionMs/1000)); await rc.set(key, '1', 'EX', ex).catch(()=>{}); } }catch(e){} }
                            console.log(`[notificationPump] sent aggregated notification for ${finalTokens.length} token(s) to user ${uid}`);
                          }catch(e){ console.error('[notificationPump] failed to send aggregated preview to', uid, e?.message||e); }
                }catch(e){ console.error('[notificationPump] per-user processing failed', e); }
              }
              // clear legacy file if it existed
              try{ await fsp.writeFile(notifFile, JSON.stringify([], null, 2), 'utf8'); } catch(e){ }
            }catch(e){ /* ignore top-level pump errors */ }
          }
          setInterval(pumpOnce, 3000);
          try { pumpOnce().catch(e=>console.error('[notificationPump] initial pump error', e)); } catch(e) { console.error('[notificationPump] initial pump scheduling failed', e); }
        };
        startNotificationPump().catch(e=>console.error('[notificationPump] start failed', e));
      } catch (e) { console.error('[notificationPump] failed to initialize', e); }
    } catch (e) { console.error('Failed to load users async:', e); users = loadUsersSync(); }

    // Register centralized buy/sell handlers now that users are loaded
    try { registerBuySellHandlers(bot, users, boughtTokens); } catch (e) { console.error('Failed to register buy/sell handlers:', e); }

    await bot.launch();
    console.log('✅ Bot launched successfully (polling)');
      try {
        // Start fast token fetcher to prioritize some users (1s polling)
        const fast = startFastTokenFetcher(users, bot.telegram, { intervalMs: 1000 });
        // Optionally keep a reference: globalThis.__fastFetcher = fast;
        // Caller may call fast.stop() to stop it.
        try {
          // Start background enrich queue conservatively
          startEnrichQueue(bot.telegram, users, { intervalMs: 2000 });
        } catch (err) { console.warn('Failed to start enrich queue:', err); }
      } catch (e) {
        console.warn('Failed to start fast token fetcher:', e);
      }
  // Background notifications reader: pick up listener-produced notifications and send to users
      (async function notificationPump(){
        const outDir = path.join(process.cwd(), 'out');
        const notifFile = path.join(outDir, 'notifications.json');
        const notifDir = path.join(outDir, 'notifications');
        console.log('[notificationPump] notifDir path:', notifDir, 'legacy file:', notifFile);
        try { await fsp.mkdir(outDir, { recursive: true }); } catch (e) {}
        try { await fsp.mkdir(notifDir, { recursive: true }); } catch (e) {}
        // suppression map: userId -> Map(addr -> lastSentTs)
        const sentNotifications: Record<string, Map<string, number>> = {};
  // For testing defaults, use 1 minute unless overridden in env
  const suppressionMinutes = Number(process.env.NOTIF_SUPPRESSION_MINUTES ?? 1);
  const suppressionMs = Math.max(0, suppressionMinutes) * 60 * 1000;
  async function collectNotificationsFromRedis(){
    const out = [];
    if(!process.env.REDIS_URL) return out;
    try{
      const IORedis = require('ioredis');
      const r = new IORedis(process.env.REDIS_URL);
      while(true){
        const item = await r.rpop('notifications');
        if(!item) break;
        try{ out.push(JSON.parse(item)); } catch(e) { /* ignore parse errors */ }
      }
      r.disconnect();
    }catch(e){ console.warn('[notificationPump] redis collect failed', e?.message||e); }
    return out;
  }
  async function collectNotificationsFromFiles(){
    const out = [];
    try{
      const files = await fsp.readdir(notifDir).catch(()=>[]);
      files.sort();
      for(const fname of files){
        const p = path.join(notifDir, fname);
        try{
          const raw = await fsp.readFile(p, 'utf8').catch(()=>null);
          if(!raw) { try{ await fsp.unlink(p).catch(()=>{}); } catch(e){}; continue; }
          try{ const obj = JSON.parse(raw); if(obj) out.push(obj); } catch(e){}
          try{ await fsp.unlink(p).catch(()=>{}); } catch(e){}
        }catch(e){}
      }
    }catch(e){ /* ignore */ }
    return out;
  }
    async function pumpOnce(){
          try{
      console.log('[notificationPump] pumpOnce triggered');
            let arr = [];
            try{ const fromRedis = await collectNotificationsFromRedis(); if(Array.isArray(fromRedis) && fromRedis.length) arr = arr.concat(fromRedis); } catch(e){}
            try{ const fromFiles = await collectNotificationsFromFiles(); if(Array.isArray(fromFiles) && fromFiles.length) arr = arr.concat(fromFiles); } catch(e){}
            if(arr.length === 0){
              try{
                const raw = await fsp.readFile(notifFile, 'utf8').catch(()=>null);
                if(raw){ try{ const legacy = JSON.parse(raw||'[]'); if(Array.isArray(legacy) && legacy.length) arr = arr.concat(legacy); } catch(e){} }
              }catch(e){}
            }
            if(!Array.isArray(arr) || arr.length===0) { console.log('[notificationPump] notifications array empty'); return; }
      console.log('[notificationPump] collected', arr.length, 'notification(s)');
            // group by user
            const byUser: Record<string, any[]> = {};
            for(const n of arr){ if(!n || !n.user) continue; if(!byUser[n.user]) byUser[n.user]=[]; byUser[n.user].push(n); }
            // process per user
            for(const uid of Object.keys(byUser)){
              try{
                const user = users[uid]; if(!user || !user.strategy || user.strategy.enabled===false) continue;
                const maxTrades = Number(user.strategy?.maxTrades || 3);
                const items = byUser[uid].slice(0, maxTrades);
                // convert matched addresses to token objects; use listener matches as authoritative
                const addrs = [].concat(...items.map(it => it.matched || it.matchAddrs || []));
                const uniq = Array.from(new Set(addrs)).slice(0, maxTrades);
                let tokens: any[] = uniq.map(a=>({ tokenAddress: a, address: a, mint: a }));
                // Enrich each address individually via DexScreener (best-effort). Do NOT drop tokens lacking Dex data.
                try{
                  for (let i = 0; i < tokens.length; i++){
                    const t = tokens[i];
                    const addr = String(t.tokenAddress || t.address || t.mint || '');
                    try{
                      // Try token profile first
                      const profiles = await fetchDexScreenerProfiles('solana', { tokenAddress: addr });
                      if (Array.isArray(profiles) && profiles.length > 0) {
                        tokens[i] = { ...t, ...profiles[0] };
                        continue;
                      }
                      // Fallback: try pairs API to get market data
                      const pairs = await fetchDexScreenerPairsForSolanaTokens([addr]).catch(() => []);
                      if (Array.isArray(pairs) && pairs.length > 0) {
                        const p = pairs[0];
                        const enriched: any = { ...t };
                        if (p.priceUsd || p.price) enriched.priceUsd = p.priceUsd || p.price;
                        enriched.pairAddress = p.pairAddress || p.pair_address || p.pairId || p.pairId || enriched.pairAddress;
                        enriched.url = enriched.url || (enriched.pairAddress ? `https://dexscreener.com/solana/${enriched.pairAddress}` : undefined) || enriched.url;
                        tokens[i] = enriched;
                      }
                    }catch(e){ /* per-address enrichment failed - keep original token object */ }
                  }
                }catch(e){ /* ignore top-level dex failures */ }
                // aggregate tokens for this user into a single message with inline buttons
                if(!sentNotifications[uid]) sentNotifications[uid] = new Map();
                const finalTokens2 = [];
                for(const tok of tokens.slice(0, maxTrades)){
                  try{
                    const addr = tok.tokenAddress || tok.address || tok.mint || '';
                    const lastMap = sentNotifications[uid];
                    const last = lastMap.get(addr) || 0;
                    if (suppressionMs > 0 && (Date.now() - last) < suppressionMs) { console.log(`[notificationPump] skipping ${addr} for user ${uid} (recently sent)`); continue; }
                    finalTokens2.push(tok);
                  }catch(e){}
                }
                if(finalTokens2.length>0){
                  try{
                    const lines = finalTokens2.map(t => {
                      const title = (t.name || t.symbol) ? `${t.name || ''}${t.symbol ? ' ('+t.symbol+')' : ''}` : t.tokenAddress.slice(0,8);
                      const price = t.priceUsd ? `${Number(t.priceUsd).toFixed(4)} USD` : 'N/A';
                      const liq = t.liquidityUsd ? `${Math.round(Number(t.liquidityUsd)).toLocaleString()} USD` : 'N/A';
                      const shortSig = (t.sourceSignature||'').substring(0,8);
                      const dex = t.url || (t.pairAddress ? `https://dexscreener.com/solana/${t.pairAddress}` : '');
                      return `• <b>${title}</b> <code>${t.tokenAddress}</code>\n  السعر: ${price} | سيولة: ${liq}\n  مصدر: ${t.sourceProgram || 'listener'} | <code>${shortSig}</code>${dex? '\n  🔗 '+dex : ''}`;
                    }).join('\n\n');
                    const keyboard = { inline_keyboard: [ finalTokens2.slice(0,5).map(t=>({ text: `${t.symbol||t.name||t.tokenAddress.slice(0,6)}`, callback_data: `view|${uid}|${t.tokenAddress}` })), [{ text: 'إيقاف الإشعارات لهذه الإستراتيجية', callback_data: `mute|${uid}|strategy` }] ] };
                    const chatId = uid;
                    const aggMsg = `🔔 <b>نتائج استراتيجيتك (${finalTokens2.length})</b>\n\n${lines}`;
                    await (bot.telegram as any).sendMessage(chatId, aggMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                    for(const t of finalTokens2){ const a = t.tokenAddress||t.address||t.mint||''; sentNotifications[uid].set(a, Date.now()); }
                    console.log(`[notificationPump] sent aggregated notification for ${finalTokens2.length} token(s) to user ${uid}`);
                  }catch(e){ console.error('[notificationPump] failed to send aggregated preview to', uid, e?.message||e); }
                }
              }catch(e){ console.error('[notificationPump] per-user processing failed', e); }
            }
            // after processing, clear legacy file if it existed
            try{ await fsp.writeFile(notifFile, JSON.stringify([], null, 2), 'utf8'); } catch(e){ }
          }catch(e){ /* ignore */ }
        }
  // run pump every 3s
  setInterval(pumpOnce, 3000);
  // run once immediately at startup to pick up any existing notifications
  try { pumpOnce().catch(e=>console.error('[notificationPump] initial pump error', e)); } catch(e) { console.error('[notificationPump] initial pump scheduling failed', e); }
      })();
  } catch (err: any) {
    if (err?.response?.error_code === 409) {
      console.error('❌ Bot launch failed: Conflict 409. Make sure the bot is not running elsewhere or stop all other sessions.');
      process.exit(1);
    } else {
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
      // Deep, accurate check path: fetch user-tailored tokens (may include on-chain enrichment) and apply strategy filter
      await ctx.reply('🔎 Performing an accurate strategy check — this may take a few seconds. Please wait...');
      // getTokensForUser will fetch Dex tokens and perform limited enrichment where needed
      const tokens = await getTokensForUser(userId, user.strategy);
      // Apply strategy filter with full checks (allow enrichment inside the filter)
      let accurate: any[] = [];
      try {
        // Limit the accurate filter to a short timeout to avoid Telegraf's 90s handler cap.
        // If it times out, enqueue a background job and inform the user.
        accurate = await withTimeout(filterTokensByStrategy(tokens, user.strategy, { fastOnly: false }), 7000, 'show_token-filter');
      } catch (e) {
        console.error('[show_token] accurate filter failed or timed out', e?.message || e);
        accurate = [];
      }

    if (!accurate || accurate.length === 0) {
      // Nothing matched after the deeper check — queue a background enrich and inform user
      try { await enqueueEnrichJob({ userId, strategy: user.strategy, requestTs: Date.now(), chatId: ctx.chat?.id }); } catch (e) { console.warn('[show_token] enqueue error:', e); }
      await ctx.reply('🔔 No matches found after a deeper check; a background verification has been queued and you will be notified if matches appear.');
      return;
    }

    // Respect user's maxTrades and present a professional list
    const maxTrades = Math.max(1, Number(user.strategy?.maxTrades || 3));
    const maxShow = Math.min(maxTrades, 10, accurate.length);
    let msg = `✅ Accurate results: <b>${accurate.length}</b> token(s) match your strategy (showing up to ${maxShow}):\n`;
    for (const t of accurate.slice(0, maxShow)) {
      try {
  const preview = buildPreviewMessage(t);
  const addr = t.tokenAddress || t.address || t.mint || '<unknown>';
  msg += `\n<b>${preview.title || addr}</b> (<code>${addr}</code>)\n${preview.shortMsg}\n`;
      } catch (e) {
        const addr = t.tokenAddress || t.address || t.mint || '<unknown>';
        msg += `\n<code>${addr}</code>\n`;
      }
    }
  try { await ctx.reply(msg, { parse_mode: 'HTML' }); } catch (e) { try { await ctx.reply('✅ Found matching tokens (accurate results).'); } catch {} }
    return;
  } catch (e) {
    console.error('[show_token] fast-preview error:', e?.stack || e);
    try { await enqueueEnrichJob({ userId, strategy: user.strategy, requestTs: Date.now(), chatId: ctx.chat?.id }); } catch {}
    await ctx.reply('❗ Internal error while producing a fast preview; a background check was queued.');
  }
});