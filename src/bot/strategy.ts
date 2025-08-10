/**
 * عند تسجيل صفقة شراء، احفظ سعر الدخول والهدف وأضف أمر بيع pending
 */
export function registerBuyWithTarget(user: any, token: any, buyResult: any, targetPercent = 10) {
  const userId = user.id || user.userId || user.telegramId;
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  let userTrades: any[] = [];
  if (fs.existsSync(userFile)) {
    try { userTrades = JSON.parse(fs.readFileSync(userFile, 'utf8')); } catch {}
  }
  const entryPrice = token.price || token.entryPrice || null;
  const amount = user.strategy.buyAmount || 0.01;
  const targetPrice = entryPrice && targetPercent ? entryPrice * (1 + targetPercent / 100) : null;
  const tx = buyResult?.buyResult?.tx;
  userTrades.push({
    mode: 'buy',
    token: token.address,
    amount,
    tx,
    entryPrice,
    targetPercent,
    targetPrice,
    time: Date.now(),
    status: tx ? 'success' : 'fail',
  });
  // سجل أمر بيع pending مرتبط بهذه الصفقة
  if (tx && targetPrice) {
    userTrades.push({
      mode: 'sell',
      token: token.address,
      amount,
      entryPrice,
      targetPercent,
      targetPrice,
      status: 'pending',
      linkedBuyTx: tx,
      time: Date.now(),
    });
  }
  fs.writeFileSync(userFile, JSON.stringify(userTrades, null, 2));
}
/**
 * مراقبة صفقات الشراء للمستخدم وتنفيذ البيع تلقائياً عند تحقق الشروط
 * @param user بيانات المستخدم
 * @param tokens قائمة العملات الحالية (مع الأسعار)
 * @param priceField اسم الحقل الذي يحتوي على السعر الحالي في token (مثلاً 'price')
 */
export async function monitorAndAutoSellTrades(user: any, tokens: any[], priceField = 'price') {
  const userId = user.id || user.userId || user.telegramId;
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  if (!fs.existsSync(userFile)) return;
  let userTrades: any[] = [];
  try { userTrades = JSON.parse(fs.readFileSync(userFile, 'utf8')); } catch {}
  // إيجاد أوامر البيع pending المرتبطة بصفقات شراء ناجحة
  const pendingSells = userTrades.filter(t => t.mode === 'sell' && t.status === 'pending' && t.targetPrice && t.linkedBuyTx);
  for (const sell of pendingSells) {
    const token = tokens.find(t => t.address === sell.token);
    if (!token || !token[priceField]) continue;
    const currentPrice = token[priceField];
    if (currentPrice >= sell.targetPrice) {
      try {
        const result = await unifiedSell(token.address, sell.amount, user.secret /*, { slippage: user.strategy.slippage }*/);
        const { fee, slippage } = extractTradeMeta(result, 'sell');
        // حدث حالة الأمر من pending إلى success
        sell.status = result?.tx ? 'success' : 'fail';
        sell.tx = result?.tx;
        sell.fee = fee;
        sell.slippage = slippage;
        sell.executedTime = Date.now();
        fs.writeFileSync(userFile, JSON.stringify(userTrades, null, 2));
      } catch (e) {
        sell.status = 'fail';
        sell.error = (e instanceof Error ? e.message : String(e));
        sell.executedTime = Date.now();
        fs.writeFileSync(userFile, JSON.stringify(userTrades, null, 2));
      }
    }
  }
}
// دالة مساعدة لاستخراج الرسوم والانزلاق من نتيجة unifiedBuy/unifiedSell
function extractTradeMeta(result: any, mode: 'buy' | 'sell') {
  let fee = null, slippage = null;
  if (mode === 'buy' && result?.buyResult) {
    fee = result.buyResult.fee ?? result.buyResult.feeAmount ?? null;
    slippage = result.buyResult.slippage ?? null;
  } else if (mode === 'sell' && result) {
    fee = result.fee ?? result.feeAmount ?? null;
    slippage = result.slippage ?? null;
  }
  return { fee, slippage };
}
import fs from 'fs';
import path from 'path';
import { unifiedBuy, unifiedSell } from '../tradeSources';
/**
 * تنفيذ صفقات متعددة (شراء أو بيع) للمستخدم على قائمة عملات
 * @param user بيانات المستخدم
 * @param tokens قائمة العملات
 * @param mode 'buy' أو 'sell'
 * @param delayMs تأخير بين كل صفقة (ms)
 */
export async function executeBatchTradesForUser(user: any, tokens: any[], mode: 'buy' | 'sell' = 'buy', delayMs = 2000) {
  if (!user || !user.wallet || !user.secret || !user.strategy) return;
  const userId = user.id || user.userId || user.telegramId;
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  if (!fs.existsSync(sentTokensDir)) fs.mkdirSync(sentTokensDir);
  let userTrades: any[] = [];
  if (fs.existsSync(userFile)) {
    try { userTrades = JSON.parse(fs.readFileSync(userFile, 'utf8')); } catch {}
  }
  for (const token of tokens) {
    try {
      let result, amount, tx = null;
      if (mode === 'buy') {
        amount = user.strategy.buyAmount || 0.01;
        result = await unifiedBuy(token.address, amount, user.secret /*, { slippage }*/);
        tx = result?.buyResult?.tx;
      } else {
        const sellPercent = user.strategy.sellPercent1 || 100;
        const balance = token.balance || 0;
        amount = (balance * sellPercent) / 100;
        result = await unifiedSell(token.address, amount, user.secret /*, { slippage }*/);
        tx = result?.tx;
      }
      const { fee, slippage } = extractTradeMeta(result, mode);
      userTrades.push({
        mode,
        token: token.address,
        amount,
        tx,
        fee,
        slippage,
        time: Date.now(),
        status: tx ? 'success' : 'fail',
      });
      fs.writeFileSync(userFile, JSON.stringify(userTrades, null, 2));
    } catch (e) {
      userTrades.push({
        mode,
        token: token.address,
        error: (e instanceof Error ? e.message : String(e)),
        time: Date.now(),
        status: 'fail',
      });
      fs.writeFileSync(userFile, JSON.stringify(userTrades, null, 2));
    }
    if (delayMs > 0) await new Promise(res => setTimeout(res, delayMs));
  }
}
import type { Strategy } from './types';

/**
 * Filters a list of tokens based on the user's strategy settings.
 * All comments and variable names are in English for clarity.
 */
export function filterTokensByStrategy(tokens: any[], strategy: Strategy): any[] {
  if (!strategy || !Array.isArray(tokens)) return [];
  return tokens.filter(token => {
    // Price in USD
    const price = Number(token.priceUsd ?? token.price ?? token.priceNative ?? 0);
    if (strategy.minPrice !== undefined && price < strategy.minPrice) return false;
    if (strategy.maxPrice !== undefined && price > strategy.maxPrice) return false;

    // Market Cap
    const marketCap = Number(token.marketCap ?? token.fdv ?? 0);
    if (strategy.minMarketCap !== undefined && marketCap < strategy.minMarketCap) return false;

    // Liquidity
    const liquidity = Number(token.liquidity ?? 0);
    if (strategy.minLiquidity !== undefined && liquidity < strategy.minLiquidity) return false;

    // Volume
    const volume = Number(token.volume ?? token.volume24h ?? 0);
    if (strategy.minVolume !== undefined && volume < strategy.minVolume) return false;

    // Holders
    const holders = Number(token.holders ?? token.totalAmount ?? 0);
    if (strategy.minHolders !== undefined && holders < strategy.minHolders) return false;

    // Age in minutes (supports ms, s, or direct minutes)
    let ageMinutes = 0;
    if (token.age !== undefined && token.age !== null) {
      let ageVal = typeof token.age === 'string' ? Number(token.age) : token.age;
      if (ageVal > 1e12) { // ms timestamp
        ageMinutes = Math.floor((Date.now() - ageVal) / 60000);
      } else if (ageVal > 1e9) { // s timestamp
        ageMinutes = Math.floor((Date.now() - ageVal * 1000) / 60000);
      } else if (ageVal < 1e7 && ageVal > 0) { // already in minutes
        ageMinutes = ageVal;
      }
    }
    if (strategy.minAge !== undefined && ageMinutes < strategy.minAge) return false;

    // Verification
    const verified = token.verified === true || token.verified === 'true' ||
      (token.baseToken && (token.baseToken.verified === true || token.baseToken.verified === 'true'));
    if (strategy.onlyVerified === true && !verified) return false;

    // Strategy enabled
    if (strategy.enabled === false) return false;

    return true;
  });
}