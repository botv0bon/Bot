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
exports.registerBuyWithTarget = registerBuyWithTarget;
exports.monitorAndAutoSellTrades = monitorAndAutoSellTrades;
exports.executeBatchTradesForUser = executeBatchTradesForUser;
exports.getStrategyEnrichMetrics = getStrategyEnrichMetrics;
exports.filterTokensByStrategy = filterTokensByStrategy;
/**
 * عند تسجيل صفقة شراء، احفظ سعر الدخول والهدف وأضف أمر بيع pending
 */
const helpers_1 = require("./helpers");
const tradeMeta_1 = require("../utils/tradeMeta");
const tradeSources_1 = require("../tradeSources");
const fs_1 = __importDefault(require("fs"));
const fsp = fs_1.default.promises;
const path_1 = __importDefault(require("path"));
async function registerBuyWithTarget(user, token, buyResult, targetPercent = 10) {
    // تأكد من وجود معرف المستخدم داخل الكائن
    const userId = user.id || user.userId || user.telegramId;
    if (!user.id && userId)
        user.id = userId;
    // إذا لم يوجد معرف، استخدم معرف من السياق أو المفتاح
    if (!user.id && typeof token === 'object' && token.userId)
        user.id = token.userId;
    // إذا لم يوجد معرف، حاول جلبه من السياق الخارجي (مثلاً من ctx)
    // إذا لم يوجد معرف بعد كل المحاولات، أوقف التنفيذ
    if (!user.id || user.id === 'undefined') {
        console.warn('[registerBuyWithTarget] Invalid userId, skipping trade record.');
        return;
    }
    const sentTokensDir = path_1.default.join(process.cwd(), 'sent_tokens');
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
    // دالة توليد معرف فريد
    function genId() {
        return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }
    const entryPrice = token.price || token.entryPrice || null;
    const amount = user.strategy.buyAmount || 0.01;
    const tx = buyResult?.tx;
    const { fee: buyFee, slippage: buySlippage } = (0, tradeMeta_1.extractTradeMeta)(buyResult, 'buy');
    // سجل صفقة الشراء
    const buyTrade = {
        id: genId(),
        mode: 'buy',
        token: token.address,
        amount,
        tx,
        entryPrice,
        time: Date.now(),
        status: tx ? 'success' : 'fail',
        strategy: { ...user.strategy },
        summary: `Buy ${token.address} | ${amount} SOL | ${tx ? 'Tx: ' + tx : 'No Tx'}`,
        fee: buyFee,
        slippage: buySlippage,
    };
    userTrades.push(buyTrade);
    // سجل أوامر البيع التلقائية (هدف1، هدف2، وقف خسارة)
    if (tx && entryPrice) {
        // هدف 1
        const target1 = user.strategy.target1 || 10;
        const sellPercent1 = user.strategy.sellPercent1 || 50;
        const targetPrice1 = entryPrice * (1 + target1 / 100);
        userTrades.push({
            id: genId(),
            mode: 'sell',
            token: token.address,
            amount: amount * (sellPercent1 / 100),
            entryPrice,
            targetPercent: target1,
            targetPrice: targetPrice1,
            status: 'pending',
            linkedBuyTx: tx,
            time: Date.now(),
            stage: 1,
            strategy: { ...user.strategy },
            summary: `AutoSell1 ${token.address} | ${sellPercent1}% | Target: ${targetPrice1}`,
        });
        // هدف 2
        const target2 = user.strategy.target2 || 20;
        const sellPercent2 = user.strategy.sellPercent2 || 50;
        const targetPrice2 = entryPrice * (1 + target2 / 100);
        userTrades.push({
            id: genId(),
            mode: 'sell',
            token: token.address,
            amount: amount * (sellPercent2 / 100),
            entryPrice,
            targetPercent: target2,
            targetPrice: targetPrice2,
            status: 'pending',
            linkedBuyTx: tx,
            time: Date.now(),
            stage: 2,
            strategy: { ...user.strategy },
            summary: `AutoSell2 ${token.address} | ${sellPercent2}% | Target: ${targetPrice2}`,
        });
        // وقف الخسارة
        const stopLoss = user.strategy.stopLoss;
        if (stopLoss && stopLoss > 0) {
            const stopLossPrice = entryPrice * (1 - stopLoss / 100);
            userTrades.push({
                id: genId(),
                mode: 'sell',
                token: token.address,
                amount: amount * ((100 - sellPercent1 - sellPercent2) / 100),
                entryPrice,
                stopLossPercent: stopLoss,
                stopLossPrice,
                status: 'pending',
                linkedBuyTx: tx,
                time: Date.now(),
                stage: 'stopLoss',
                strategy: { ...user.strategy },
                summary: `StopLoss ${token.address} | ${stopLoss}% | Price: ${stopLossPrice}`,
            });
        }
    }
    // persist trades using queued async writer
    try {
        await (0, helpers_1.writeJsonFile)(userFile, userTrades);
    }
    catch { }
}
/**
 * مراقبة صفقات الشراء للمستخدم وتنفيذ البيع تلقائياً عند تحقق الشروط
 * @param user بيانات المستخدم
 * @param tokens قائمة العملات الحالية (مع الأسعار)
 * @param priceField اسم الحقل الذي يحتوي على السعر الحالي في token (مثلاً 'price')
 */
async function monitorAndAutoSellTrades(user, tokens, priceField = 'price') {
    const userId = user.id || user.userId || user.telegramId;
    const sentTokensDir = path_1.default.join(process.cwd(), 'sent_tokens');
    const userFile = path_1.default.join(sentTokensDir, `${userId}.json`);
    try {
        const stat = await fsp.stat(userFile).catch(() => false);
        if (!stat)
            return;
    }
    catch {
        return;
    }
    let userTrades = [];
    try {
        const data = await fsp.readFile(userFile, 'utf8');
        userTrades = JSON.parse(data || '[]');
    }
    catch { }
    // إيجاد أوامر البيع pending المرتبطة بصفقات شراء ناجحة
    const pendingSells = userTrades.filter(t => t.mode === 'sell' && t.status === 'pending' && t.linkedBuyTx);
    for (const sell of pendingSells) {
        const token = tokens.find(t => t.address === sell.token);
        if (!token || !token[priceField])
            continue;
        const currentPrice = token[priceField];
        let shouldSell = false;
        // تحقق من أهداف الربح
        if (sell.targetPrice && currentPrice >= sell.targetPrice)
            shouldSell = true;
        // تحقق من وقف الخسارة
        if (sell.stopLossPrice && currentPrice <= sell.stopLossPrice)
            shouldSell = true;
        if (shouldSell) {
            try {
                const result = await (0, tradeSources_1.unifiedSell)(token.address, sell.amount, user.secret /*, { slippage: user.strategy.slippage }*/);
                const { fee, slippage } = (0, tradeMeta_1.extractTradeMeta)(result, 'sell');
                // حدث حالة الأمر من pending إلى success
                sell.status = result?.tx ? 'success' : 'fail';
                sell.tx = result?.tx;
                sell.fee = fee;
                sell.slippage = slippage;
                sell.executedTime = Date.now();
                try {
                    await (0, helpers_1.writeJsonFile)(userFile, userTrades);
                }
                catch { }
            }
            catch (e) {
                sell.status = 'fail';
                sell.error = (e instanceof Error ? e.message : String(e));
                sell.executedTime = Date.now();
                try {
                    await (0, helpers_1.writeJsonFile)(userFile, userTrades);
                }
                catch { }
            }
        }
    }
}
// (imports consolidated at top)
/**
 * تنفيذ صفقات متعددة (شراء أو بيع) للمستخدم على قائمة عملات
 * @param user بيانات المستخدم
 * @param tokens قائمة العملات
 * @param mode 'buy' أو 'sell'
 * @param delayMs تأخير بين كل صفقة (ms)
 */
async function executeBatchTradesForUser(user, tokens, mode = 'buy', delayMs = 2000) {
    if (!user || !user.wallet || !user.secret || !user.strategy)
        return;
    const userId = user.id || user.userId || user.telegramId;
    const sentTokensDir = path_1.default.join(process.cwd(), 'sent_tokens');
    const userFile = path_1.default.join(sentTokensDir, `${userId}.json`);
    try {
        await fsp.mkdir(sentTokensDir, { recursive: true });
    }
    catch { }
    let userTrades = [];
    try {
        const stat = await fsp.stat(userFile).catch(() => false);
        if (stat) {
            const data = await fsp.readFile(userFile, 'utf8');
            userTrades = JSON.parse(data || '[]');
        }
    }
    catch { }
    for (const token of tokens) {
        try {
            let result, amount, tx = null;
            if (mode === 'buy') {
                amount = user.strategy.buyAmount || 0.01;
                result = await (0, tradeSources_1.unifiedBuy)(token.address, amount, user.secret /*, { slippage }*/);
                tx = result?.tx;
            }
            else {
                const sellPercent = user.strategy.sellPercent1 || 100;
                const balance = token.balance || 0;
                amount = (balance * sellPercent) / 100;
                result = await (0, tradeSources_1.unifiedSell)(token.address, amount, user.secret /*, { slippage }*/);
                tx = result?.tx;
            }
            const { fee, slippage } = (0, tradeMeta_1.extractTradeMeta)(result, mode);
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
            try {
                await (0, helpers_1.writeJsonFile)(userFile, userTrades);
            }
            catch { }
        }
        catch (e) {
            userTrades.push({
                mode,
                token: token.address,
                error: (e instanceof Error ? e.message : String(e)),
                time: Date.now(),
                status: 'fail',
            });
            try {
                await (0, helpers_1.writeJsonFile)(userFile, userTrades);
            }
            catch { }
        }
        if (delayMs > 0)
            await new Promise(res => setTimeout(res, delayMs));
    }
}
const config_1 = require("../config");
const tokenUtils_1 = require("../utils/tokenUtils");
// Enrichment metrics for selective enrichment
const __strategy_enrich_metrics = { attempts: 0, successes: 0, failures: 0, enrichedTokens: 0 };
function getStrategyEnrichMetrics() {
    return { ...__strategy_enrich_metrics };
}
/**
 * Filters a list of tokens based on the user's strategy settings.
 * All comments and variable names are in English for clarity.
 */
async function filterTokensByStrategy(tokens, strategy, opts) {
    if (!strategy || !Array.isArray(tokens))
        return [];
    // Integrated enrichment: attempt to enrich tokens with on-chain timestamps and freshness
    // using Helius (RPC/parse/websocket), Solscan and RPC fallbacks. This improves age
    // detection and allows downstream freshness scoring to be used in filters.
    if (tokens.length > 0) {
        try {
            const utils = await Promise.resolve().then(() => __importStar(require('../utils/tokenUtils')));
            // Merge realtime sources (Helius WS buffer, DexScreener top, Helius parse-history) so filters
            // operate on a richer, corroborated set. Use existing fastTokenFetcher helper to gather latest candidates.
            try {
                const ff = await Promise.resolve().then(() => __importStar(require('../fastTokenFetcher')));
                const latest = await ff.fetchLatest5FromAllSources(10).catch(() => null);
                if (latest) {
                    const extras = [];
                    const pushAddr = (a) => { if (!a)
                        return; const s = String(a); if (!s)
                        return; extras.push({ address: s, tokenAddress: s, mint: s, sourceCandidates: true }); };
                    (latest.heliusEvents || []).forEach(pushAddr);
                    (latest.dexTop || []).forEach(pushAddr);
                    (latest.heliusHistory || []).forEach(pushAddr);
                    // merge extras into a local copy so we don't mutate caller's array
                    const localTokens = tokens.slice();
                    const seen = new Set(localTokens.map(t => (t.tokenAddress || t.address || t.mint || '').toString()));
                    for (const ex of extras) {
                        const key = ex.tokenAddress || ex.address || ex.mint || '';
                        if (!key)
                            continue;
                        if (!seen.has(key)) {
                            localTokens.push(ex);
                            seen.add(key);
                        }
                    }
                    tokens = localTokens;
                    try {
                        console.log('[filterTokensByStrategy] merged realtime sources; extraCandidates=', extras.length);
                    }
                    catch { }
                }
            }
            catch (e) {
                try {
                    console.warn('[filterTokensByStrategy] failed to fetch realtime candidates', e && e.message ? e.message : e);
                }
                catch { }
            }
            const enrichPromise = utils.enrichTokenTimestamps(tokens, {
                batchSize: Number(config_1.HELIUS_BATCH_SIZE || 6),
                delayMs: Number(config_1.HELIUS_BATCH_DELAY_MS || 300)
            });
            // Start enrichment in background (non-blocking) so filtering remains responsive.
            // Log outcome for diagnostics but do not block the caller.
            enrichPromise
                .then(() => { try {
                console.log('[filterTokensByStrategy] background enrichment completed');
            }
            catch (_) { } })
                .catch((err) => { try {
                console.warn('[filterTokensByStrategy] background enrichment failed:', err && err.message ? err.message : err);
            }
            catch (_) { } });
        }
        catch (e) {
            console.warn('[filterTokensByStrategy] enrichment failed or timed out:', e?.message || e);
        }
    }
    // Use helpers from tokenUtils for robust field extraction and fast filtering
    const utils = require('../utils/tokenUtils');
    const { getField, autoFilterTokens, parseDuration } = utils;
    // 1) Fast pass: use `autoFilterTokensVerbose` for the simple numeric checks (marketCap, liquidity, volume, basic age rules)
    const prelimVerbose = (0, tokenUtils_1.autoFilterTokensVerbose)(tokens, strategy);
    const prelim = Array.isArray(prelimVerbose) ? prelimVerbose : (prelimVerbose && prelimVerbose.passed ? prelimVerbose.passed : tokens);
    // Selective enrichment: when the strategy requires strict numeric/on-chain checks,
    // enrich a small set of top candidates (bounded concurrency) to obtain liquidity/volume/age fields
    try {
        const needStrictNumeric = (strategy.minLiquidity !== undefined || strategy.minVolume !== undefined || strategy.minAge !== undefined || strategy.requireOnchain === true);
        if (needStrictNumeric && Array.isArray(prelim) && prelim.length > 0) {
            const tu = require('../utils/tokenUtils');
            const candidateLimit = Number(process.env.STRATEGY_ENRICH_CANDIDATES || 8);
            const concurrency = Math.max(1, Number(process.env.STRATEGY_ENRICH_CONCURRENCY || 3));
            const timeoutMs = Number(process.env.STRATEGY_ENRICH_TIMEOUT_MS || 2000);
            const candidates = prelim.slice(0, Math.min(candidateLimit, prelim.length));
            if (candidates.length) {
                let idx = 0;
                const worker = async () => {
                    while (true) {
                        const i = idx++;
                        if (i >= candidates.length)
                            break;
                        const tok = candidates[i];
                        try {
                            __strategy_enrich_metrics.attempts++;
                            // officialEnrich mutates the token in-place with poolOpenTimeMs, liquidity, volume, freshnessScore
                            await tu.officialEnrich(tok, { amountUsd: Number(strategy.buyAmount) || undefined, timeoutMs });
                            // heuristics: consider enrichment successful if we obtained any of these fields
                            if (tok && (tok.poolOpenTimeMs || tok.liquidity || tok.volume || tok._canonicalAgeSeconds)) {
                                __strategy_enrich_metrics.successes++;
                                __strategy_enrich_metrics.enrichedTokens++;
                            }
                            else {
                                __strategy_enrich_metrics.failures++;
                            }
                        }
                        catch (e) {
                            __strategy_enrich_metrics.failures++;
                            // ignore per-token enrichment errors
                        }
                    }
                };
                const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker());
                try {
                    await Promise.all(workers);
                }
                catch (e) { }
                // merge enriched candidates back into prelim by canonical address
                try {
                    const keyOf = (t) => String(t && (t.tokenAddress || t.address || t.mint || t.pairAddress || '')).toLowerCase();
                    const enrichedMap = {};
                    for (const e of candidates) {
                        const k = keyOf(e);
                        if (k)
                            enrichedMap[k] = e;
                    }
                    for (let i = 0; i < prelim.length; i++) {
                        try {
                            const k = keyOf(prelim[i]);
                            if (k && enrichedMap[k])
                                prelim[i] = enrichedMap[k];
                        }
                        catch (e) { }
                    }
                }
                catch (e) { }
            }
        }
    }
    catch (e) {
        // non-fatal: continue with existing prelim if enrichment fails
    }
    // 2) Apply the remaining, more expensive or strict checks on the pre-filtered list
    const filtered = prelim.filter(token => {
        // Price checks (optional)
        const price = Number(getField(token, 'priceUsd', 'price', 'priceNative', 'baseToken.priceUsd', 'baseToken.price')) || 0;
        if (strategy.minPrice !== undefined && price < strategy.minPrice)
            return false;
        if (strategy.maxPrice !== undefined && price > strategy.maxPrice)
            return false;
        // Holders check (may not be covered by autoFilterTokens depending on STRATEGY_FIELDS)
        const holders = Number(getField(token, 'holders', 'totalAmount', 'baseToken.holders', 'baseToken.totalAmount')) || 0;
        if (strategy.minHolders !== undefined && holders < strategy.minHolders)
            return false;
        // Age checks: compute age in seconds with no integer-flooring to preserve fractional minutes/seconds
        let ageSeconds = undefined;
        // Prefer canonical age if present (set by merge/ensureCanonicalOnchainAges)
        if (token && token._canonicalAgeSeconds !== undefined && token._canonicalAgeSeconds !== null) {
            ageSeconds = Number(token._canonicalAgeSeconds);
        }
        const ageVal = getField(token, 'ageSeconds', 'ageMinutes', 'age', 'createdAt', 'created_at', 'creation_date', 'created', 'poolOpenTime', 'poolOpenTimeMs', 'listed_at', 'listedAt', 'genesis_date', 'published_at', 'time', 'timestamp', 'first_trade_time', 'baseToken.createdAt', 'baseToken.published_at');
        if (ageVal !== undefined && ageVal !== null) {
            if (typeof ageVal === 'number') {
                if (ageVal > 1e12) { // ms timestamp
                    ageSeconds = (Date.now() - ageVal) / 1000;
                }
                else if (ageVal > 1e9) { // s timestamp
                    ageSeconds = (Date.now() - ageVal * 1000) / 1000;
                }
                else {
                    // treat as minutes
                    ageSeconds = Number(ageVal) * 60;
                }
            }
            else if (typeof ageVal === 'string') {
                // try numeric string
                const n = Number(ageVal);
                if (!isNaN(n)) {
                    if (n > 1e9)
                        ageSeconds = (Date.now() - n * 1000) / 1000;
                    else
                        ageSeconds = n * 60;
                }
                else {
                    // try duration parse (parseDuration returns seconds)
                    const parsed = parseDuration(ageVal);
                    if (parsed !== undefined)
                        ageSeconds = parsed;
                    else {
                        const parsedDate = Date.parse(ageVal);
                        if (!isNaN(parsedDate))
                            ageSeconds = (Date.now() - parsedDate) / 1000;
                    }
                }
            }
        }
        else if (typeof token.ageSeconds === 'number') {
            ageSeconds = token.ageSeconds;
        }
        else if (typeof token.ageMinutes === 'number') {
            ageSeconds = token.ageMinutes * 60;
        }
        // If age is unknown and the strategy requires a minimum age, reject tokens
        // that don't have a known on-chain age when the required min age is >= 60s
        // (treat numeric strategy.minAge as minutes for backward compatibility).
        const minAgeSeconds = strategy.minAge !== undefined
            ? (typeof strategy.minAge === 'string' ? parseDuration(strategy.minAge) : Number(strategy.minAge) * 60)
            : undefined;
        if (minAgeSeconds !== undefined) {
            if (ageSeconds === undefined || isNaN(ageSeconds)) {
                // Require a known on-chain age for any minAge >= 60 seconds (1 minute).
                if (minAgeSeconds >= 60)
                    return false;
                // For very small minAge (< 60s) remain permissive when age unknown.
            }
            else {
                if (ageSeconds < minAgeSeconds)
                    return false;
            }
        }
        // Freshness / on-chain requirement checks
        try {
            const minFresh = strategy?.minFreshnessScore !== undefined ? Number(strategy.minFreshnessScore) : undefined;
            if (!isNaN(Number(minFresh)) && typeof token.freshnessScore === 'number') {
                if ((token.freshnessScore || 0) < Number(minFresh))
                    return false;
            }
            if (strategy?.requireOnchain) {
                const onChainTs = token?.freshnessDetails?.onChainTs || token?.freshnessDetails?.firstTxMs || null;
                if (!onChainTs)
                    return false;
            }
        }
        catch (e) {
            // ignore scoring errors and proceed
        }
        // Enforce strict onlyReal tokens when requested by strategy
        if (strategy?.onlyReal === true) {
            const hasOnchain = !!(token?.freshnessDetails?.onChainTs || token?.freshnessDetails?.firstTxMs || token.poolOpenTimeMs || token.firstBlockTime || token.metadataExists);
            // If no on-chain evidence or metadata, reject as likely noise/memo
            if (!hasOnchain)
                return false;
        }
        // Verification
        const verified = getField(token, 'verified', 'baseToken.verified') === true || getField(token, 'verified', 'baseToken.verified') === 'true';
        if (strategy.onlyVerified === true && !verified)
            return false;
        // Strategy enabled check
        if (strategy.enabled === false)
            return false;
        return true;
    });
    return filtered;
}
