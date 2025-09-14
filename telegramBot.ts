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
import { STRATEGY_FIELDS, notifyUsers, withTimeout } from './src/utils/tokenUtils';
import { buildPreviewMessage } from './src/utils/tokenUtils';
// Background enrich/queue disabled: listener-only operation per user requirement.
import { registerBuySellHandlers } from './src/bot/buySellHandlers';
import { normalizeStrategy } from './src/utils/strategyNormalizer';
// fast token fetcher disabled: listener-only operation
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
    // If canonical-only mode is enabled, route logs to stderr (verbose) instead of stdout
    if (CANONICAL_ONLY) {
      try { _origError('[VERBOSE]', s); return; } catch (e) {}
    }
  } catch (e) {}
  _origWarn(...args);
};
console.error = (...args: any[]) => {
  try {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (_filterRegex.test(s)) return;
    // Always write errors to stderr; in canonical-only mode we prefer stderr so leave as-is
  } catch (e) {}
  _origError(...args);
};
console.log = (...args: any[]) => {
  try {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (_filterRegex.test(s)) return;
    if (CANONICAL_ONLY) {
      try { _origError('[VERBOSE]', s); return; } catch (e) {}
    }
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
// Enforce listener-only safe mode: when true, avoid making disk-based reads/writes in active user paths.
// Controlled via env LISTENER_ONLY_MODE or LISTENER_ONLY. Default to false (production-enabled).
// Set LISTENER_ONLY_MODE=true in the environment to opt back into safe listener-only behavior.
const LISTENER_ONLY_MODE = String(process.env.LISTENER_ONLY_MODE ?? process.env.LISTENER_ONLY ?? 'false').toLowerCase() === 'true';
// Allow skipping the actual Telegram launch for local dry-runs/tests. When SKIP_TELEGRAM_LAUNCH=true
// the script will still load users, register handlers and start the in-process listener, but will
// not call `bot.launch()` (avoids 409 conflicts). Additionally, when DRY_RUN_NO_TELEGRAM=true the
// notification handler will log messages it would send instead of calling Telegram APIs.
const SKIP_TELEGRAM_LAUNCH = String(process.env.SKIP_TELEGRAM_LAUNCH || 'false').toLowerCase() === 'true';
const DRY_RUN_NO_TELEGRAM = String(process.env.DRY_RUN_NO_TELEGRAM || 'false').toLowerCase() === 'true';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// When true, the process MUST only print canonical outputs to stdout (array line + metadata line).
// Use `DETAILED_LOGS=true` to enable verbose logs to stderr for monitoring.
const CANONICAL_ONLY = String(process.env.CANONICAL_ONLY ?? 'true').toLowerCase() === 'true';
const DETAILED_LOGS = String(process.env.DETAILED_LOGS ?? 'true').toLowerCase() === 'true';
// By default the bot should not emit canonical JSON lines for UI preview actions.
// Set BOT_EMIT_CANONICAL=true in environment to allow the bot to emit canonical
// two-line JSON outputs (array + metadata) from UI flows such as Show Tokens.
const BOT_EMIT_CANONICAL = String(process.env.BOT_EMIT_CANONICAL || 'false').toLowerCase() === 'true';
// Developer monitor: when true, force verbose diagnostic mode and print every event
// emitted by the listener and notification pump to the developer terminal via _origLog.
const DEV_MONITOR = String(process.env.DEV_MONITOR || 'false').toLowerCase() === 'true';
if (DEV_MONITOR) {
  try{ _origLog('[DEV_MONITOR] enabled - forcing verbose diagnostics and BOT_EMIT_CANONICAL'); }catch(e){}
}
// Effective canonical emit flag: DEV_MONITOR implies bot-level canonical emits
const EFFECTIVE_BOT_EMIT_CANONICAL = BOT_EMIT_CANONICAL || DEV_MONITOR;

function emitCanonicalLines(arr: any[], meta: Record<string, any>) {
  try {
    // Always write canonical lines to stdout so other tools can parse them.
    process.stdout.write(JSON.stringify(arr) + '\n');
    process.stdout.write(JSON.stringify(meta) + '\n');
  } catch (e) {
    // Fallback: log to stderr
    try { console.error('[emitCanonicalLines] failed', e); } catch (e) {}
  }
}

function verboseLog(...args: any[]) {
  if (!DETAILED_LOGS && !DEV_MONITOR) return;
  try { _origError('[VERBOSE]', ...args); } catch (e) {}
}
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_TOKEN);
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not found in .env file. Please add TELEGRAM_BOT_TOKEN=YOUR_TOKEN to .env');
  process.exit(1);
}
const bot = new Telegraf(TELEGRAM_TOKEN);
console.log('--- Telegraf instance created ---');
let users: Record<string, any> = {};
console.log('--- Users placeholder created ---');
// console suppression is handled by the top-level console wrappers when CANONICAL_ONLY is set
let boughtTokens: Record<string, Set<string>> = {};
const restoreStates: Record<string, boolean> = {};

// Helper: decide if a given user should operate in listener-only (no enrichment) mode.
function userIsListenerOnly(user: any) {
  try {
    if (LISTENER_ONLY_MODE) return true;
    if (!user) return false;
    const strat = user.strategy || {};
    if (strat && (strat.noEnrich === true || strat.listenerOnly === true)) return true;
    return false;
  } catch (e) { return Boolean(LISTENER_ONLY_MODE); }
}

async function getTokensForUser(userId: string, strategy: Record<string, any> | undefined) {
  // Listener-only token source: always use the program-listener collector
  try {
    // Only use strategy.maxTrades to determine how many tokens to collect for the user.
    const maxCollect = Math.max(1, Number(strategy?.maxTrades || 1));
    // Require the sequential listener collector as the sole source of tokens.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const seq = require('./scripts/sequential_10s_per_program.js');
    if (!seq || typeof seq.collectFreshMints !== 'function') return [];
    const strictOverride = (strategy && (strategy as any).collectorStrict !== undefined) ? Boolean((strategy as any).collectorStrict) : undefined;
    const items = await seq.collectFreshMints({ maxCollect, timeoutMs: 20000, strictOverride }).catch(() => []);
    if (!Array.isArray(items) || items.length === 0) return [];
    const tokens = (items || []).map((it: any) => {
      if (!it) return null;
      if (typeof it === 'string') return { tokenAddress: it, address: it, mint: it, sourceCandidates: true, __listenerCollected: true };
      const addr = it.tokenAddress || it.address || it.mint || null;
      return Object.assign({ tokenAddress: addr, address: addr, mint: addr, sourceCandidates: true, __listenerCollected: true }, it);
    }).filter(Boolean);
    // Ensure we only present explicit-created tokens, preserve order (newest first),
    // deduplicate by mint/address, and limit to the user's configured maxTrades.
    const beforeCount = tokens.length;
    const onlyExplicit = tokens.filter((t:any) => t && (t.createdHere === true));
    // deduplicate by canonical mint/address preserving the first occurrence
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const t of onlyExplicit) {
      try{
        const addr = (t && (t.mint || t.tokenAddress || t.address)) || null;
        if (!addr) continue;
        if (seen.has(addr)) continue;
        seen.add(addr);
        unique.push(t);
      }catch(e){}
    }
    const afterCount = unique.length;
    verboseLog('[getTokensForUser] explicit-unique filtered', { requested: maxCollect, beforeCount, afterCount });
    // return up to the user's requested number of trades
    return unique.slice(0, maxCollect);
    // Do NOT apply any minMarketCap/minLiquidity/minVolume/minAge filtering here — per user request
    // we only use the per-user `maxTrades` to limit results.
    return tokens;
  } catch (e) {
    console.error('[getTokensForUser] listener fetch failed:', e?.message || e);
    return [];
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

// Add a quick toggle button for collector strictness to main keyboard if desired
function collectorToggleKeyboard(user: any) {
  try{
    const cur = user && user.strategy && (user.strategy as any).collectorStrict;
    const label = cur === false ? 'Collector: Defer' : (cur === true ? 'Collector: Strict' : 'Collector: Default');
    return Markup.keyboard([
      ['💼 Wallet', '⚙️ Strategy'],
      ['📊 Show Tokens', '🤝 Invite Friends'],
      [label]
    ]).resize();
  }catch(e){ return mainReplyKeyboard; }
}

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
    // reuse getTokensForUser to fetch listener candidates. Only limit by maxTrades.
    const strategyRef = (user && user.strategy) ? user.strategy : {};
    const tokens = await getTokensForUser(userId, strategyRef).catch(()=>[]);
    if (!tokens || tokens.length === 0) {
      await ctx.reply('No live tokens found right now. Try again in a few seconds.');
      return;
    }
    // build a richer per-token preview using buildPreviewMessage
    const maxTrades = Math.max(1, Number(strategyRef?.maxTrades || 1));
    const showTokens = tokens.slice(0, maxTrades);
    let text = `🔔 <b>Live tokens (preview)</b>\nFound ${tokens.length} candidates (showing up to ${maxTrades}):\n`;
    for (const t of showTokens) {
      try {
        const preview = buildPreviewMessage(t);
        const addr = t && (t.tokenAddress || t.address || t.mint) || '<unknown>';
        text += `\n<b>${preview.title || addr}</b> (<code>${addr}</code>)\n${preview.shortMsg}\n`;
      } catch (e) {
        const addr = t && (t.tokenAddress || t.address || t.mint) || '<unknown>';
        text += `\n<code>${addr}</code>\n`;
      }
    }
    try {
      await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true } as any);
    } catch (e) {
      try { await ctx.reply('✅ Found live tokens.'); } catch (_) {}
    }
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
  // Invoke same behavior as /show_token for a fast preview
  try {
    // Delegate to the existing command handler by calling the logic inline
    const userId = String(ctx.from?.id);
    const user = users[userId];
    if (!user || !user.strategy || user.strategy.enabled === false) {
      try { await ctx.reply('🔎 Showing latest live mints (you have no strategy set). Use /strategy to configure filters.'); } catch(e){}
    }
    // reuse getTokensForUser to fetch listener candidates
    const strategyRef = (user && user.strategy) ? user.strategy : {};
    const tokens = await getTokensForUser(userId, strategyRef).catch(()=>[]);
    if (!tokens || tokens.length === 0) {
      await ctx.reply('No live tokens found right now. Try again in a few seconds.');
      return;
    }
    // build a richer per-token preview using buildPreviewMessage
    let text = `🔔 <b>Live tokens (preview)</b>\nFound ${tokens.length} candidates:\n`;
    for (const t of tokens.slice(0, Math.max(1, Number(strategyRef?.maxTrades || 3)))) {
      try {
        const preview = buildPreviewMessage(t);
        const addr = t && (t.tokenAddress || t.address || t.mint) || '<unknown>';
        text += `\n<b>${preview.title || addr}</b> (<code>${addr}</code>)\n${preview.shortMsg}\n`;
      } catch (e) {
        const addr = t && (t.tokenAddress || t.address || t.mint) || 'unknown';
        text += `• <code>${addr}</code>\n`;
      }
    }
    // Cache preview so the user can choose to send it live via an inline button
    try {
      // Build HTML version for later send
      const html = text;
      // store in-memory cache for this user
      try { previewCache[String(ctx.from?.id)] = { html, addrs: (tokens || []).map((t:any)=> t && (t.tokenAddress||t.address||t.mint)).filter(Boolean) }; } catch(e){}
      const inline = Markup.inlineKeyboard([[Markup.button.callback('✅ Send Now', 'send_show_preview')]]);
      await ctx.reply(text, ({ parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: inline.reply_markup } as any));
    } catch (e) {
      try { await ctx.reply('Error preparing preview.'); } catch(_){ }
    }
    // Emit canonical lines for external consumers: array of addresses + metadata
    try{
      const addrs = (tokens || []).map((t:any)=> t && (t.tokenAddress||t.address||t.mint)).filter(Boolean);
      const meta = { time: new Date().toISOString(), kind: 'show_preview', requestedBy: String(ctx.from?.id), count: addrs.length } as any;
  if (EFFECTIVE_BOT_EMIT_CANONICAL) {
        emitCanonicalLines(addrs, meta);
        verboseLog('[show_tokens] emitted canonical', meta);
      } else {
        verboseLog('[show_tokens] canonical suppressed by BOT_EMIT_CANONICAL=false', meta);
      }
    }catch(e){ verboseLog('[show_tokens] emit failed', e); }
  } catch (e) {
    try { await ctx.reply('Error fetching live tokens.'); } catch(_){}
  }
});

// In-memory cache for show-token previews per user
const previewCache: Record<string, { html: string, addrs: string[] }> = {};

// Handler for the inline 'Send Now' button. This will send the real Telegram message
// to the requesting user, bypassing DRY_RUN for explicit manual tests.
bot.action('send_show_preview', async (ctx) => {
  try {
    const userId = String(ctx.from?.id);
    verboseLog('[send_show_preview] clicked by', userId);
    const cache = previewCache[userId];
    if (!cache) {
      try { await ctx.answerCbQuery('Preview expired or not found. Please press Show Tokens again.'); } catch(_){}
      return;
    }
    // Acknowledge the button press immediately
    try { await ctx.answerCbQuery('Sending preview now...'); } catch(_){}

    // Send the cached HTML message using the real Telegram API regardless of DRY_RUN flag
    try {
      await bot.telegram.sendMessage(userId, cache.html, { parse_mode: 'HTML', disable_web_page_preview: true } as any);
      verboseLog('[send_show_preview] real send complete for', userId);
      try { await ctx.reply('✅ Message sent.'); } catch(_){}
    } catch (e:any) {
      console.error('[send_show_preview] failed to send message:', e?.message || e);
      try { await ctx.reply('❌ Failed to send message: ' + (e?.message || String(e))); } catch(_){}
    }
  } catch (e:any) {
    console.error('[send_show_preview] handler error:', e?.message || e);
  }
});

bot.hears('🤝 Invite Friends', async (ctx) => {
  console.log(`[🤝 Invite Friends] User: ${String(ctx.from?.id)}`);
  const userId = String(ctx.from?.id);
  const inviteLink = `https://t.me/${ctx.me}?start=${userId}`;
  await ctx.reply(`🤝 Share this link to invite your friends:\n${inviteLink}`);
});

bot.hears(/Collector:\s*(Strict|Defer|Default)/i, async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId] || {};
  const cur = user.strategy && (user.strategy as any).collectorStrict;
  // cycle: undefined -> false -> true -> undefined
  let next: any = undefined;
  if (cur === undefined) next = false;
  else if (cur === false) next = true;
  else next = undefined;
  if (!user.strategy) user.strategy = {};
  (user.strategy as any).collectorStrict = next;
  users[userId] = user;
  try { saveUsers(users); } catch (e) {}
  const label = next === false ? 'Collector: Defer' : (next === true ? 'Collector: Strict' : 'Collector: Default');
  await ctx.reply(`Collector strictness set to: ${label}`);
  try { await ctx.reply('Keyboard updated', collectorToggleKeyboard(user)); } catch (e) {}
});

bot.command('toggle_collector_strict', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId] || {};
  const cur = user.strategy && (user.strategy as any).collectorStrict;
  let next: any = undefined;
  if (cur === undefined) next = false;
  else if (cur === false) next = true;
  else next = undefined;
  if (!user.strategy) user.strategy = {};
  (user.strategy as any).collectorStrict = next;
  users[userId] = user;
  try { saveUsers(users); } catch (e) {}
  const label = next === false ? 'Defer' : (next === true ? 'Strict' : 'Default');
  await ctx.reply(`collectorStrict toggled to: ${label}`);
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
  let filteredTokens = [] as any[];
  if (userIsListenerOnly(user)) {
    // Preserve the listener-provided candidates without background enrichment
    filteredTokens = tokens.slice(0, Math.max(1, Number(user.strategy?.maxTrades || 3)));
  } else {
    filteredTokens = await (require('./src/bot/strategy').filterTokensByStrategy(tokens, user.strategy, { preserveSources: true }));
  }
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
      if (LISTENER_ONLY_MODE) {
        // In listener-only mode avoid reading user sent_tokens files on disk.
        // Assume in-memory/Redis suppression is handled elsewhere.
      } else {
        if (!(await fsp.stat(userFile).catch(() => false))) continue;
      }
    } catch {
      continue;
    }
    let userTrades: any[] = [];
    try {
      if (!LISTENER_ONLY_MODE) {
        const data = await fsp.readFile(userFile, 'utf8');
        userTrades = JSON.parse(data || '[]');
      } else {
        userTrades = [];
      }
    } catch {}
    const executed = userTrades.filter((t: any) => t.mode === 'sell' && t.status === 'success' && t.auto && !t.notified);
    for (const sellOrder of executed) {
      await notifyAutoSell(user, sellOrder);
      (sellOrder as any).notified = true;
    }
    try {
  if (!LISTENER_ONLY_MODE) await writeJsonFile(userFile, userTrades);
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
  // startEnrichQueue disabled: listener is the only allowed source

      // Disable background file/redis polling notification pump. Instead listen to
      // in-process notifier events emitted by the listener and deliver messages
      // immediately to users (no central caches or disk reads).
      try {
  // in-memory suppression map (userId -> Map(addr -> lastSentTs))
  // Do not use suppression; always allow sending up to user.strategy.maxTrades
  const sentNotifications: Record<string, Map<string, number>> = {};
  const suppressionMs = 0;
        // require the exported notifier from the listener script (if it's loaded in-process)
        let listenerNotifier: any = null;
        try{ const seqMod = require('./scripts/sequential_10s_per_program.js'); listenerNotifier = seqMod && seqMod.notifier ? seqMod.notifier : null; }catch(e){}
        // Extract notification handling to a shared function so stdin and notifier both use same logic
        async function handleNotification(userEvent: any) {
          try{
            const uid = String(userEvent && userEvent.user);
            verboseLog('[handleNotification] incoming for uid', uid);
            if(!uid) return;
            const user = users[uid];
            verboseLog('[handleNotification] userLoaded', Boolean(user), 'strategyLoaded', Boolean(user && user.strategy), 'enabled', user && user.strategy && user.strategy.enabled);
            if(!user || !user.strategy || user.strategy.enabled === false) return;
            if(!sentNotifications[uid]) sentNotifications[uid] = new Map();
            // derive addresses to check suppression from matched or tokens
            // Prefer explicit freshMints when present (especially for initialize events)
            const matchAddrs = (Array.isArray(userEvent.freshMints) && userEvent.freshMints.length) ? userEvent.freshMints : (Array.isArray(userEvent.matched) && userEvent.matched.length ? userEvent.matched : (Array.isArray(userEvent.tokens) ? (userEvent.tokens.map((t:any)=>t.tokenAddress||t.address||t.mint).filter(Boolean)) : []));
            const maxTrades = Number(user.strategy?.maxTrades || 3);
            verboseLog('[handleNotification] matchAddrs', matchAddrs, 'maxTrades', maxTrades);
            const toSend = (matchAddrs || []).slice(0, maxTrades).map(a => a);
            verboseLog('[handleNotification] toSend', toSend);
            if(!toSend || toSend.length===0) return;
            // prefer pre-built HTML payload if present
            try{
              const chatId = uid;
              if(DRY_RUN_NO_TELEGRAM){
                // In dry-run mode, log the payload that would be sent instead of calling Telegram
                if(!CANONICAL_ONLY){
                  if(userEvent.html && typeof userEvent.html === 'string'){
                    try{ _origError(`[DRY_SEND] chatId=${chatId} html=${userEvent.html.slice(0,200)}`); }catch(e){}
                  } else {
                    let text = `🔔 Matched tokens for your strategy\nProgram: ${userEvent.program}\nSignature: ${userEvent.signature}\n`;
                    text += `Matched (${toSend.length}): ${toSend.slice(0,10).join(', ')}`;
                    try{ _origError(`[DRY_SEND] chatId=${chatId} text=${text}`); }catch(e){}
                  }
                }
              } else {
                if(userEvent.html && typeof userEvent.html === 'string'){
                  const options: any = ({ parse_mode: 'HTML', disable_web_page_preview: false } as any);
                  if(userEvent.inlineKeyboard) options.reply_markup = { inline_keyboard: userEvent.inlineKeyboard };
                  await (bot.telegram as any).sendMessage(chatId, userEvent.html, options).catch(()=>{});
                } else {
                  // fallback: simple list message
                  let text = `🔔 <b>Matched tokens for your strategy</b>\nProgram: <code>${userEvent.program}</code>\nSignature: <code>${userEvent.signature}</code>\n\n`;
                  text += `Matched (${toSend.length}):\n`;
                  for(const a of toSend.slice(0,10)) text += `• <code>${a}</code>\n`;
                  text += `\nTime: ${new Date().toISOString()}`;
                  await (bot.telegram as any).sendMessage(chatId, text, ({ parse_mode: 'HTML', disable_web_page_preview: true } as any)).catch(()=>{});
                }
              }
              for(const a of toSend) sentNotifications[uid].set(a, Date.now());
            }catch(e){ /* swallow */ }
          }catch(e){ /* swallow per-event errors */ }
        }
        // register handler on the exported notifier if present
        if(listenerNotifier && typeof listenerNotifier.on === 'function'){
          listenerNotifier.on('notification', handleNotification);
          // Developer monitor: also log every notification payload to the developer terminal
          if (DEV_MONITOR) {
            try{ listenerNotifier.on('notification', (p:any) => { try{ _origLog('[DEV_MONITOR][notification]', JSON.stringify(p)); }catch(e){} }); }catch(e){}
            try{ listenerNotifier.on('programEvent', (e:any) => { try{ _origLog('[DEV_MONITOR][programEvent]', JSON.stringify(e)); }catch(e){} }); }catch(e){}
          }
        }
        // Also support reading JSON notifications directly from stdin (one JSON object per line)
        try{
          try{
            const rl = require('readline').createInterface({ input: process.stdin, terminal: false });
            rl.on('line', (line: string) => {
              try{
                if(!line || !line.trim()) return;
                const payload = JSON.parse(line.trim());
                verboseLog('[stdin-notif] parsed payload', payload && payload.user, payload && payload.freshMints);
                try{ listenerNotifier && listenerNotifier.emit && listenerNotifier.emit('notification', payload); }catch(e){}
              }catch(e){ verboseLog('[stdin-notif] failed to parse line', e && e.message); }
            });
            rl.on('close', () => {
              verboseLog('[stdin-notif] stdin closed');
              try{
                if(String(process.env.EXIT_ON_STDIN_DONE || '').toLowerCase() === 'true'){
                  // give a short grace period for handlers to finish then exit
                  setTimeout(() => {
                    verboseLog('[stdin-notif] EXIT_ON_STDIN_DONE triggered - exiting');
                    try{ process.exit(0); }catch(e){}
                  }, 800);
                }
              }catch(e){}
            });
          }catch(e){ verboseLog('[stdin-notif] readline setup failed', e && e.message); }
        }catch(e){}
        // Optional: test notification directory. When set via TEST_NOTIFICATION_DIR env var,
        // watch that directory for new JSON files and emit their contents as 'notification' events
        // into the listenerNotifier. This is a local testing hook and only activates when the
        // TEST_NOTIFICATION_DIR environment variable is provided.
        try{
          const TEST_NOTIFICATION_DIR = process.env.TEST_NOTIFICATION_DIR || null;
          if(TEST_NOTIFICATION_DIR && listenerNotifier){
            try{ fs.mkdirSync(TEST_NOTIFICATION_DIR, { recursive: true }); }catch(e){}
            try{
              fs.watch(TEST_NOTIFICATION_DIR, { persistent: false }, (ev, fname) => {
                if(!fname) return;
                // only on new files (rename event) attempt to read then emit
                if(ev !== 'rename') return;
                const full = path.join(TEST_NOTIFICATION_DIR, fname as string);
                // delay slightly to allow write to finish
                setTimeout(() => {
                  try{
                    const raw = fs.readFileSync(full, 'utf8');
                    const payload = JSON.parse(raw);
                    try{ listenerNotifier.emit('notification', payload); }catch(e){}
                    try{ fs.unlinkSync(full); }catch(e){}
                  }catch(e){ /* ignore read/parse errors */ }
                }, 150);
              });
              verboseLog('[test-notif] watching', TEST_NOTIFICATION_DIR);
            }catch(e){ verboseLog('[test-notif] watch failed', e); }
          }
        }catch(e){}
        // also drain in-memory queues (if listener and bot are same process) at startup
        try{
          const q = (global as any).__inMemoryNotifQueues;
          if(q && q instanceof Map){
            for(const [k, arr] of q.entries()){
              try{
                const items = Array.isArray(arr) ? arr.slice(0) : [];
                for(const it of items.reverse()){
                  try{
                    if (DEV_MONITOR) try{ _origLog('[DEV_MONITOR][inMemoryDrain] emitting', JSON.stringify(it)); }catch(e){}
                    listenerNotifier && listenerNotifier.emit && listenerNotifier.emit('notification', it);
                  }catch(e){}
                }
                // clear after drain
                q.set(k, []);
              }catch(e){}
            }
          }
        }catch(e){}
        // Optionally start a Redis consumer loop if REDIS_URL provided (cross-process delivery)
        try{
          const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI || null;
          if(REDIS_URL){
            (async function startRedisConsumer(){
              try{
                const { createClient } = require('redis');
                const rc = createClient({ url: REDIS_URL });
                rc.on && rc.on('error', ()=>{});
                await rc.connect().catch(()=>{});
                const pollInterval = Number(process.env.NOTIF_REDIS_POLL_MS || 1000);
                while(true){
                  try{
                    // iterate users map keys and BRPOP each list with 1s timeout
                    for(const uid of Object.keys(users || {})){
                      try{
                        const key = `listener:notifications:${uid}`;
                        const res = await rc.rPop(key).catch(()=>null);
                        if(res){
                          try{ const payload = JSON.parse(res); listenerNotifier && listenerNotifier.emit && listenerNotifier.emit('notification', payload); }catch(e){}
                        }
                      }catch(e){}
                    }
                    await new Promise(r=>setTimeout(r, pollInterval));
                  }catch(e){ await new Promise(r=>setTimeout(r, 1000)); }
                }
              }catch(e){ console.error('[redisNotifConsumer] failed', e && e.message || e); }
            })();
          }
        }catch(e){}
      } catch (e) { console.error('[notificationPump] replacement handler failed', e); }
    } catch (e) { console.error('Failed to load users async:', e); users = loadUsersSync(); }

    // Register centralized buy/sell handlers now that users are loaded
    try { registerBuySellHandlers(bot, users, boughtTokens); } catch (e) { console.error('Failed to register buy/sell handlers:', e); }

    if(!SKIP_TELEGRAM_LAUNCH){
      await bot.launch();
      console.log('✅ Bot launched successfully (polling)');
    } else {
      console.log('⚠️ SKIP_TELEGRAM_LAUNCH=true - skipping actual bot.launch() (dry-run)');
    }
      try {
        // Start fast token fetcher to prioritize some users (1s polling)
  // Do NOT start fast token fetcher or enrich queue - listener is the single source of truth per requirement.
      // Start the sequential listener in-process so users receive live pushes from the listener
      try{
        const seq = require('./scripts/sequential_10s_per_program.js');
        if(seq && typeof seq.startSequentialListener === 'function'){
          // run listener without blocking (it manages its own loop)
          (async ()=>{ try{ await seq.startSequentialListener(); }catch(e){ try{ console.error('[listener] failed to start:', e && e.message || e); }catch(_){} } })();
          console.log('[listener] startSequentialListener invoked in-process');
        }
      }catch(e){ console.warn('Failed to start listener in-process:', e); }
      } catch (e) {
        console.warn('Failed to start fast token fetcher:', e);
      }
  // Note: background disk/redis notification pump disabled — using in-process notifier for immediate delivery.
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
  // Allow preview even if the user has not configured a strategy yet.
  // For users without a strategy we'll show live listener candidates (fast preview)
  // and invite them to configure a strategy for filtered results.
  if (!user || !user.strategy || user.strategy.enabled === false) {
    try { await ctx.reply('🔎 Showing latest live mints (you have no strategy set). Use /strategy to configure filters.'); } catch(e){}
  }
  try {
    // If user's numeric strategy fields are all zero/undefined, present listener/live candidates immediately
    const strategyRef = (user && user.strategy) ? user.strategy : {};
    const numericKeys = ['minMarketCap','minLiquidity','minVolume','minAge'];
    const hasNumericConstraint = numericKeys.some(k => {
      const v = strategyRef && (strategyRef as any)[k];
      return v !== undefined && v !== null && Number(v) > 0;
    });
    if (!hasNumericConstraint) {
      // Fast path: return listener-produced candidates (or fastFetcher) without heavy enrichment
      try { await ctx.reply('🔎 Fetching latest live mints from listener — fast preview...'); } catch(e){}
      // Try to use the sequential listener's one-shot collector when available.
      // If the listener module exists but returns no fresh mints, DO NOT fallback to DexScreener
      // to avoid showing older tokens — queue a background enrich instead and inform the user.
      let tokens: any[] = [];
      let listenerAvailable = false;
      try{
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const seq = require('./scripts/sequential_10s_per_program.js');
        if(seq && typeof seq.collectFreshMints === 'function'){
          listenerAvailable = true;
          // convert user's strategy.minAge to seconds when present
          let maxAgeSec: number | undefined = undefined;
          try{
            const ma = strategyRef && (strategyRef as any).minAge;
            if(ma !== undefined && ma !== null){
              // allow strings like '10s', '5m', or plain numbers
              const s = String(ma).trim().toLowerCase();
              const secMatch = s.match(/^([0-9]+)s$/);
              const minMatch = s.match(/^([0-9]+)m$/);
              if(secMatch) maxAgeSec = Number(secMatch[1]);
              else if(minMatch) maxAgeSec = Number(minMatch[1]) * 60;
              else if(!isNaN(Number(s))){
                const n = Number(s);
                // treat small values (0,1,2) as seconds per prior convention
                if(n <= 2) maxAgeSec = n;
                else maxAgeSec = n * 60;
              }
            }
          }catch(e){}
          const strictOverride = (user && user.strategy && (user.strategy as any).collectorStrict !== undefined) ? Boolean((user.strategy as any).collectorStrict) : undefined;
          const addrs = await seq.collectFreshMints({ maxCollect: Math.max(1, Number(user.strategy?.maxTrades || 3)), timeoutMs: 20000, maxAgeSec, strictOverride }).catch(()=>[]);
          tokens = (addrs || []).map((a:any)=>({ tokenAddress: a, address: a, mint: a, sourceCandidates: true, __listenerCollected: true }));
        }
      }catch(e){ listenerAvailable = false; }
      if(listenerAvailable){
        if(!tokens || tokens.length===0){
          // Per listener-only mode, do not enqueue external enrich jobs. Inform the user to wait for listener events.
          await ctx.reply('🔔 لا توجد نتائج مستمع حديثة الآن؛ يرجى الانتظار بينما يستمر مصدر الاستماع بجمع النتائج.');
          return;
        }
      } else {
        // Listener not available: per requirement do NOT fallback to external fetchers or caches.
        await ctx.reply('⚠️ مستمع البرامج غير متاح حالياً؛ لا يمكن جلب البيانات من مصادر خارجية وفق سياسة التشغيل. برجاء التأكد من تشغيل مصدر الاستماع أو حاول لاحقاً.');
        return;
      }
      console.log('[show_token] fast-path tokens:', (tokens || []).length);
      // If these tokens are live candidates (from listener/fastFetcher), present immediately
      if (Array.isArray(tokens) && tokens.length && tokens.every(t => (t as any).sourceCandidates || (t as any).matched || (t as any).tokenAddress)) {
        if(!CANONICAL_ONLY) console.log('[show_token] presenting live/sourceCandidates without heavy filter');
        // debug: print token provenance & freshness hints
        try{
          for(const t of tokens){
            try{
              console.error('[show_token-debug] token', { addr: t.tokenAddress||t.address||t.mint, listenerCollected: !!t.__listenerCollected, freshness: t._canonicalAgeSeconds || t.ageSeconds || t.ageMinutes || null });
            }catch(e){}
          }
        }catch(e){}
        // proceed to render below as live results
      } else {
        // no tokens to show
      }
      if (!tokens || tokens.length === 0) {
        // Listener-only: no background enrichment queued. Inform the user to wait for fresh listener events.
        await ctx.reply('🔔 No recent listener results found; please wait for the listener to collect fresh mints.');
        return;
      }
      const maxTrades = Math.max(1, Number(user.strategy?.maxTrades || 3));
      const maxShow = Math.min(maxTrades, 10, tokens.length);
      let msg = `✅ Live results: <b>${tokens.length}</b> token(s) available (showing up to ${maxShow}):\n`;
      for (const t of tokens.slice(0, maxShow)) {
        try {
          const preview = buildPreviewMessage(t);
          const addr = t.tokenAddress || t.address || t.mint || '<unknown>';
          msg += `\n<b>${preview.title || addr}</b> (<code>${addr}</code>)\n${preview.shortMsg}\n`;
        } catch (e) {
          const addr = t.tokenAddress || t.address || t.mint || '<unknown>';
          msg += `\n<code>${addr}</code>\n`;
        }
      }
      try { await ctx.reply(msg, { parse_mode: 'HTML' }); } catch (e) { try { await ctx.reply('✅ Found live matching tokens.'); } catch {} }
      // Emit canonical lines for these fast-path tokens
      try{
        const addrs = (tokens || []).map((t:any)=> t && (t.tokenAddress||t.address||t.mint)).filter(Boolean);
        const meta = { time: new Date().toISOString(), kind: 'show_preview_fast', user: userId, count: addrs.length } as any;
  if (EFFECTIVE_BOT_EMIT_CANONICAL) {
          emitCanonicalLines(addrs, meta);
        } else {
          verboseLog('[show_preview_fast] canonical suppressed by BOT_EMIT_CANONICAL=false', meta);
        }
        verboseLog('[show_token] emitted canonical fast-path', meta);
      }catch(e){ verboseLog('[show_token] emit failed', e); }
      return;
    }

    // Deep, accurate check path: fetch user-tailored tokens (may include on-chain enrichment) and apply strategy filter
    // If the user prefers listener-only/no-enrich, skip heavy enrichment and present listener candidates
    if (userIsListenerOnly(user)) {
      try { await ctx.reply('🔎 You are in listener-only mode (no enrichment). Presenting live listener candidates...'); } catch(e){}
      const tokens = await getTokensForUser(userId, user.strategy);
      if (tokens && tokens.length) {
        const maxTrades = Math.max(1, Number(user.strategy?.maxTrades || 3));
        const maxShow = Math.min(maxTrades, 10, tokens.length);
        let msg = `✅ Live listener-only results: <b>${tokens.length}</b> token(s) available (showing up to ${maxShow}):\n`;
        for (const t of tokens.slice(0, maxShow)) {
          try { const preview = buildPreviewMessage(t); const addr = t.tokenAddress || t.address || t.mint || '<unknown>'; msg += `\n<b>${preview.title || addr}</b> (<code>${addr}</code>)\n${preview.shortMsg}\n`; } catch (e) { const addr = t.tokenAddress || t.address || t.mint || '<unknown>'; msg += `\n<code>${addr}</code>\n`; }
        }
        try { await ctx.reply(msg, { parse_mode: 'HTML' }); } catch(e) { try { await ctx.reply('✅ Found live listener-only tokens.'); } catch(_){} }
        return;
      }
      // If no tokens from getTokensForUser, try collector one-shot raw addresses as a last resort
      try{
        const seq = require('./scripts/sequential_10s_per_program.js');
        if(seq && typeof seq.collectFreshMints === 'function'){
          const maxCollect = Math.max(1, Number(user.strategy?.maxTrades || 3));
          let maxAgeSec: number | undefined = undefined;
          try{ const ma = user.strategy && (user.strategy as any).minAge; if(ma !== undefined && ma !== null){ const s = String(ma).trim().toLowerCase(); const secMatch = s.match(/^([0-9]+)s$/); const minMatch = s.match(/^([0-9]+)m$/); if(secMatch) maxAgeSec = Number(secMatch[1]); else if(minMatch) maxAgeSec = Number(minMatch[1]) * 60; else if(!isNaN(Number(s))){ const n = Number(s); maxAgeSec = n <= 2 ? n : n * 60; } } }catch(e){}
          const strictOverride = (user && user.strategy && (user.strategy as any).collectorStrict !== undefined) ? Boolean((user.strategy as any).collectorStrict) : undefined;
          const addrs = await seq.collectFreshMints({ maxCollect, timeoutMs: 20000, maxAgeSec, strictOverride }).catch(()=>[]);
          if(Array.isArray(addrs) && addrs.length > 0){ try{ await ctx.reply('🔔 Live listener results (raw):\n' + JSON.stringify(addrs.slice(0, Math.max(10, addrs.length)), null, 2)); }catch(e){ try{ await ctx.reply('🔔 Live listener results: ' + addrs.join(', ')); }catch(e){} } return; }
            if(Array.isArray(addrs) && addrs.length > 0){
              try{
                const meta = { time: new Date().toISOString(), kind: 'collector_raw', user: userId, count: addrs.length } as any;
                if (EFFECTIVE_BOT_EMIT_CANONICAL) {
                  emitCanonicalLines(addrs, meta);
                } else {
                  verboseLog('[live_show_tokens] canonical suppressed by BOT_EMIT_CANONICAL=false', meta);
                }
                verboseLog('[show_token] emitted canonical collector raw', meta);
              }catch(e){ verboseLog('[show_token] emit failed', e); }
            }
        }
      }catch(e){}
      await ctx.reply('🔔 No live listener results available at the moment; please wait.');
      return;
    }

    // perform accurate filtering for non-listener-only users
    await ctx.reply('🔎 Performing an accurate strategy check — this may take a few seconds. Please wait...');
    const tokens = await getTokensForUser(userId, user.strategy);
    let accurate: any[] = [];
    try {
      accurate = await withTimeout(filterTokensByStrategy(tokens, user.strategy, { fastOnly: false }), 7000, 'show_token-filter');
    } catch (e) {
      console.error('[show_token] accurate filter failed or timed out', e?.message || e);
      accurate = [];
    }

    if (!accurate || accurate.length === 0) {
      // Nothing matched after the deeper check — as a last-resort try the listener one-shot collector
      try{
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const seq = require('./scripts/sequential_10s_per_program.js');
        if(seq && typeof seq.collectFreshMints === 'function'){
          const maxCollect = Math.max(1, Number(user.strategy?.maxTrades || 3));
          // derive maxAgeSec from user's minAge
          let maxAgeSec: number | undefined = undefined;
          try{
            const ma = user.strategy && (user.strategy as any).minAge;
            if(ma !== undefined && ma !== null){
              const s = String(ma).trim().toLowerCase();
              const secMatch = s.match(/^([0-9]+)s$/);
              const minMatch = s.match(/^([0-9]+)m$/);
              if(secMatch) maxAgeSec = Number(secMatch[1]);
              else if(minMatch) maxAgeSec = Number(minMatch[1]) * 60;
              else if(!isNaN(Number(s))){ const n = Number(s); maxAgeSec = n <= 2 ? n : n * 60; }
            }
          }catch(e){}
          const strictOverride = (user && user.strategy && (user.strategy as any).collectorStrict !== undefined) ? Boolean((user.strategy as any).collectorStrict) : undefined;
          const addrs = await seq.collectFreshMints({ maxCollect, timeoutMs: 20000, maxAgeSec, strictOverride }).catch(()=>[]);
          if(Array.isArray(addrs) && addrs.length > 0){
            // Return raw payload so user sees actual live mints discovered
            try{ await ctx.reply('🔔 Live listener results (raw):\n' + JSON.stringify(addrs.slice(0, Math.max(10, addrs.length)), null, 2)); }catch(e){ try{ await ctx.reply('🔔 Live listener results: ' + addrs.join(', ')); }catch(e){} }
            return;
          }
        }
      }catch(e){ /* ignore collector errors */ }
      // Listener-only: no background enrich queued. Inform the user to wait for listener events.
      await ctx.reply('🔔 No matches found after a deeper check; please wait for the listener to produce fresh results.');
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
  await ctx.reply('❗ Internal error while producing a fast preview; please try again later or wait for listener events.');
  }
});