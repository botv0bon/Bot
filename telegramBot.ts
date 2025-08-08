// =================== Imports ===================
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import { STRATEGY_FIELDS, buildTokenMessage, autoFilterTokens, notifyUsers, fetchDexScreenerTokens } from './src/utils/tokenUtils';
import { Keypair } from '@solana/web3.js';
import { Markup, Telegraf } from 'telegraf';
import fetch from 'node-fetch';
import { loadUsers, saveUsers, walletKeyboard, getErrorMessage, limitHistory, hasWallet } from './src/bot/helpers';
import { helpMessages } from './src/helpMessages';
import { unifiedBuy, unifiedSell } from './src/tradeSources';
import { filterTokensByStrategy } from './src/bot/strategy';
import { autoExecuteStrategyForUser } from './src/autoStrategyExecutor';

let users: Record<string, any> = loadUsers();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env file. Please add TELEGRAM_BOT_TOKEN=YOUR_TOKEN to .env');
  process.exit(1);
}
console.log('Loaded token:', TELEGRAM_TOKEN);
const bot = new Telegraf(TELEGRAM_TOKEN);
let globalTokenCache: any[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 1000 * 60 * 2; // 1 دقائق
let boughtTokens: Record<string, Set<string>> = {};

bot.action(/buy_(.+)/, async (ctx: any) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  const tokenAddress = ctx.match[1];
  if (!user || !user.secret || !user.strategy || !user.strategy.enabled) {
    await ctx.reply('❌ لا يوجد استراتيجية أو محفظة مفعلة.');
    return;
  }
  try {
    await ctx.reply(`🛒 جاري تنفيذ عملية الشراء للرمز: <code>${tokenAddress}</code> ...`, { parse_mode: 'HTML' });
    // قيمة افتراضية للشراء 0.01 SOL
    const amount = 0.01;
    const result = await unifiedBuy(tokenAddress, amount, user.secret);
    if (result?.buyResult?.tx) {
      if (!boughtTokens[userId]) boughtTokens[userId] = new Set();
      boughtTokens[userId].add(tokenAddress);
      // حفظ العملية في سجل المستخدم
      if (user) {
        const entry = `ManualBuy: ${tokenAddress} | Amount: ${amount} SOL | Source: unifiedBuy | Tx: ${result.buyResult.tx}`;
        user.history = user.history || [];
        user.history.push(entry);
        saveUsers(users);
      }
      await ctx.reply('تم شراء الرمز بنجاح!');
    } else {
      await ctx.reply('فشل الشراء: لم يتم تنفيذ العملية.');
    }
  } catch (e: any) {
    await ctx.reply(`❌ حدث خطأ أثناء الشراء: ${e?.message || e}`);
    console.error('buy error:', e);
  }
});

// زر المحفظة
bot.command('wallet', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (user && user.secret) {
    await ctx.reply(`🔑 محفظتك:
${user.secret}`);
  } else {
    await ctx.reply('❌ لا توجد محفظة مسجلة لهذا المستخدم.');
  }
});

// زر إنشاء أو استرداد المحفظة
bot.command(['create_wallet', 'restore_wallet'], async (ctx) => {
  // منطق الإنشاء أو الاسترداد (تجريبي)
  await ctx.reply('🪙 سيتم إنشاء أو استرداد المحفظة هنا (يرجى ربط المنطق الفعلي لاحقًا).');
});

// زر الاستراتيجية المرتبط بالفلتر ودوال البيع والشراء
bot.command('strategy', async (ctx) => {
  const userId = String(ctx.from?.id);
  const user = users[userId];
  if (!user || !user.strategy) {
    await ctx.reply('❌ لا توجد استراتيجية مفعلة لهذا المستخدم.');
    return;
  }
  // تطبيق الفلتر على الرموز
  const filteredTokens = filterTokensByStrategy(globalTokenCache, user.strategy);
  await ctx.reply(`⚡ الرموز بعد الفلترة:
${filteredTokens.map(t => t.symbol).join(', ') || 'لا يوجد رموز مطابقة.'}`);
  // مثال: ربط دوال البيع والشراء
  await ctx.reply('يمكنك الآن استخدام أزرار البيع والشراء على الرموز المفلترة.');
});

// زر Show Token لعرض معلومات الرمز
bot.command('show_token', async (ctx) => {
  const tokenAddress = (ctx.message.text.split(' ')[1] || '').trim();
  if (!tokenAddress) {
    await ctx.reply('❗ يرجى إرسال عنوان الرمز بعد الأمر. مثال: /show_token <token_address>');
    return;
  }
  // منطق جلب معلومات الرمز (تجريبي)
  await ctx.reply(`🔍 معلومات الرمز:
${tokenAddress}`);
});

// أمر /start لإظهار رسالة ترحيب
bot.start(async (ctx) => {
  await ctx.reply('👋 أهلاً بك! البوت يعمل الآن. يمكنك تجربة الأوامر مثل /wallet أو /strategy.');
});

// تشغيل البوت بنظام polling فقط
(async () => {
  try {
    await bot.launch();
    console.log('✅ Bot launched successfully (polling)');
  } catch (err: any) {
    if (err?.response?.error_code === 409) {
      console.error('❌ Bot launch failed: Conflict 409. تأكد من عدم تشغيل البوت في مكان آخر أو إيقاف جميع الجلسات الأخرى.');
      process.exit(1);
    } else {
      console.error('❌ Bot launch failed:', err);
      process.exit(1);
    }
  }
})();