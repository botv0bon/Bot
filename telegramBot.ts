// =================== Imports ===================
import dotenv from 'dotenv';
import fs from 'fs';
const fsp = fs.promises;
import { Telegraf, Markup } from 'telegraf';
import { loadUsers, loadUsersSync, saveUsers, walletKeyboard, getErrorMessage, limitHistory, hasWallet, writeJsonFile } from './src/bot/helpers';
import { helpMessages } from './src/helpMessages';
import { unifiedBuy, unifiedSell } from './src/tradeSources';
import { filterTokensByStrategy, registerBuyWithTarget, monitorAndAutoSellTrades } from './src/bot/strategy';
import { autoExecuteStrategyForUser } from './src/autoStrategyExecutor';
import { STRATEGY_FIELDS, buildTokenMessage, autoFilterTokens, notifyUsers, fetchDexScreenerTokens } from './src/utils/tokenUtils';
import { registerBuySellHandlers } from './src/bot/buySellHandlers';
import { normalizeStrategy } from './src/utils/strategyNormalizer';
import { startFastTokenFetcher } from './src/fastTokenFetcher';
import { generateKeypair, exportSecretKey, parseKey } from './src/wallet';

console.log('--- Bot starting: Imports loaded ---');

dotenv.config();

console.log('--- dotenv loaded ---');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_TOKEN);
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not found in .env file. Please add TELEGRAM_BOT_TOKEN=YOUR_TOKEN to .env');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_TOKEN as string);
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
        const prefiltered = (() => {
          try { return tokenUtils.autoFilterTokens(tokens, fastStrategy); } catch { return tokens; }
        })();
        const resolvedPrefiltered = Array.isArray(prefiltered) ? prefiltered : tokens;
        // enrich only top candidates (by liquidity then volume)
        const enrichLimit = Number(process.env.HELIUS_ENRICH_LIMIT || 25);
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
        const { enrichTokenTimestamps } = await import('./src/utils/tokenUtils');
        await enrichTokenTimestamps(toEnrich, { batchSize: Number(process.env.HELIUS_BATCH_SIZE || 8), delayMs: Number(process.env.HELIUS_BATCH_DELAY_MS || 250) });
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
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [ { text: '👁️ Show Private Key', callback_data: 'show_secret' } ]
          ]
        }
      }
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
  const filteredTokens = await (require('./src/bot/strategy').filterTokensByStrategy(tokens, user.strategy));
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
      const keypair = parseKey(secret);
      let user = users[userId] || {};
      user.secret = exportSecretKey(keypair);
      user.wallet = keypair.publicKey?.toBase58?.() || keypair.publicKey;
      users[userId] = user;
      saveUsers(users);
      delete restoreStates[userId];

      await ctx.reply(`✅ Wallet restored successfully!\nAddress: <code>${user.wallet}</code>\nPrivate key stored securely.`, { parse_mode: 'HTML' });
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

        let buyResults: string[] = [];
        let successCount = 0, failCount = 0;
        for (const token of tokensToTrade) {
          const tokenAddress = token.tokenAddress || token.address || token.mint || token.pairAddress;
          const buyAmount = user.strategy.buyAmount || 0.01;
          const name = token.name || token.symbol || tokenAddress;
          const price = token.priceUsd || token.price || '-';
          const dexUrl = token.url || (token.pairAddress ? `https://dexscreener.com/solana/${token.pairAddress}` : '');
          console.log(`[show_token] Attempting buy: User: ${userId}, Token: ${tokenAddress}, Amount: ${buyAmount}`);
          try {
            const buyResult = await unifiedBuy(tokenAddress, buyAmount, user.secret);
            console.log(`[show_token] Buy result:`, buyResult);
            if (buyResult && buyResult.tx) {
              successCount++;
              // سجل العملية في التاريخ
              const entry = `AutoShowTokenBuy: ${tokenAddress} | Amount: ${buyAmount} SOL | Source: unifiedBuy | Tx: ${buyResult.tx}`;
              user.history = user.history || [];
              user.history.push(entry);
              limitHistory(user);
              saveUsers(users);
              // سجل أمر بيع تلقائي
              const targetPercent = user.strategy.targetPercent || 10;
              try { await registerBuyWithTarget(user, { address: tokenAddress, price }, buyResult, targetPercent); } catch (e) { console.error('registerBuyWithTarget error:', e); }
              buyResults.push(`🟢 <b>${name}</b> (<code>${tokenAddress}</code>)\nPrice: <b>${price}</b> USD\nAmount: <b>${buyAmount}</b> SOL\nTx: <a href='https://solscan.io/tx/${buyResult.tx}'>${buyResult.tx}</a>\n<a href='${dexUrl}'>DexScreener</a> | <a href='https://solscan.io/token/${tokenAddress}'>Solscan</a>\n------------------------------`);
            } else {
              failCount++;
              console.log(`[show_token] Buy failed for token: ${tokenAddress}`);
              buyResults.push(`🔴 <b>${name}</b> (<code>${tokenAddress}</code>)\n❌ Failed to buy.`);
            }
          } catch (e) {
            failCount++;
            console.log(`[show_token] Error during buy for token: ${tokenAddress}`, e);
            buyResults.push(`🔴 <b>${name}</b> (<code>${tokenAddress}</code>)\n❌ Error: ${getErrorMessage(e)}`);
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
  if (!user || !hasWallet(user) || !user.strategy || !user.strategy.enabled) {
    await ctx.reply('❌ No active strategy or wallet found.');
    return;
  }
  try {
    const amount = user.strategy.buyAmount || 0.01;
    await ctx.reply(`🛒 Buying token: <code>${tokenAddress}</code> with amount: <b>${amount}</b> SOL ...`, { parse_mode: 'HTML' });
    const result = await unifiedBuy(tokenAddress, amount, user.secret);
    if (result && result.tx) {
      const entry = `ShowTokenBuy: ${tokenAddress} | Amount: ${amount} SOL | Source: unifiedBuy | Tx: ${result.tx}`;
      user.history = user.history || [];
      user.history.push(entry);
      limitHistory(user);
      saveUsers(users);
      await ctx.reply(`Token bought successfully! Tx: ${result.tx}`);
    } else {
      await ctx.reply('Buy failed: Transaction was not completed.');
    }
  } catch (e) {
    await ctx.reply('❌ Error during buy: ' + getErrorMessage(e));
    console.error('showtoken buy error:', e);
  }
});

bot.action(/showtoken_sell_(.+)/, async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  const tokenAddress = ctx.match[1];
  console.log(`[showtoken_sell] User: ${userId}, Token: ${tokenAddress}`);
  if (!user || !hasWallet(user) || !user.strategy || !user.strategy.enabled) {
    await ctx.reply('❌ No active strategy or wallet found.');
    return;
  }
  try {
    const sellPercent = user.strategy.sellPercent1 || 100;
    // For demo, assume full balance = buyAmount
    const balance = user.strategy.buyAmount || 0.01;
    const amount = (balance * sellPercent) / 100;
    await ctx.reply(`🔻 Selling token: <code>${tokenAddress}</code> with <b>${sellPercent}%</b> of your balance (${balance}) ...`, { parse_mode: 'HTML' });
    const result = await unifiedSell(tokenAddress, amount, user.secret);
    if (result && result.tx) {
      const entry = `ShowTokenSell: ${tokenAddress} | Amount: ${amount} | Source: unifiedSell | Tx: ${result.tx}`;
      user.history = user.history || [];
      user.history.push(entry);
      limitHistory(user);
      saveUsers(users);
      await ctx.reply(`Token sold successfully! Tx: ${result.tx}`);
    } else {
      await ctx.reply('Sell failed: Transaction was not completed.');
    }
  } catch (e) {
    await ctx.reply('❌ Error during sell: ' + getErrorMessage(e));
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
      users = await loadUsers();
      console.log('--- Users loaded (async) ---');
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
    } catch (e) {
      console.warn('Failed to start fast token fetcher:', e);
    }
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