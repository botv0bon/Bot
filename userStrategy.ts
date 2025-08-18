import { Connection, PublicKey } from '@solana/web3.js';
/**
 * Fetch the user's Solana balance
 */
export async function getSolBalance(userSecret: string): Promise<number> {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const secretKey = Uint8Array.from(Buffer.from(userSecret, 'base64'));
  const keypair = require('@solana/web3.js').Keypair.fromSecretKey(secretKey);
  const balance = await connection.getBalance(keypair.publicKey);
  return balance / 1e9; // تحويل من lamports إلى SOL
}
import fs from 'fs';
const fsp = fs.promises;
import path from 'path';
import { writeJsonFile } from './src/bot/helpers';

/**
 * Record a buy or sell operation in the user's file inside sent_tokens
 */
export async function recordUserTrade(userId: string, trade: any) {
  if (!userId || userId === 'undefined') {
    console.warn('[recordUserTrade] Invalid userId, skipping trade record.');
    return;
  }
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  try { await fsp.mkdir(sentTokensDir, { recursive: true }); } catch {}
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  let userTrades: any[] = [];
  try { const stat = await fsp.stat(userFile).catch(() => false); if (stat) { const data = await fsp.readFile(userFile, 'utf8'); userTrades = JSON.parse(data || '[]'); } } catch {}
  userTrades.push({ ...trade, time: Date.now() });
  try { await writeJsonFile(userFile, userTrades); } catch {}
}
// userStrategy.ts
require('dotenv').config();
// Handles Honey Points strategy logic for Telegram bot

// No need to import fs since all operations are on the in-memory users object

export type HoneyToken = {
  address: string;
  buyAmount: number;
  profitPercents: number[]; // Profit percentages for each stage
  soldPercents: number[];   // Sell percentages for each stage
  lastEntryPrice?: number;
  lastSellPrice?: number;
  finished?: boolean;
  status?: 'pending' | 'active' | 'sold' | 'error'; // For bot UI feedback
  currentStage?: number; // Track which profit stage is next
  lastTxId?: string; // Last transaction ID for feedback
  volume?: number;
  ageMinutes?: number;
};

export type HoneySettings = {
  tokens: HoneyToken[];
  repeatOnEntry: boolean;
};

/**
 * Get user's Honey Points strategy settings
 */
export function getHoneySettings(userId: string, users: Record<string, any>): HoneySettings {
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
export function setHoneySettings(userId: string, settings: HoneySettings, users: Record<string, any>) {
  if (!users[userId]) users[userId] = {};
  users[userId].honeySettings = settings;
}

/**
 * Add a new token to the Honey Points strategy
 */
export function addHoneyToken(userId: string, token: HoneyToken, users: Record<string, any>) {
  const settings = getHoneySettings(userId, users);
  if (settings.tokens.length >= 10) throw new Error('Maximum 10 tokens allowed.');
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
export function removeHoneyToken(userId: string, tokenAddress: string, users: Record<string, any>) {
  const settings = getHoneySettings(userId, users);
  settings.tokens = settings.tokens.filter(t => t.address !== tokenAddress);
  setHoneySettings(userId, settings, users);
}

/**
 * Reset all tokens in the Honey Points strategy
 */
export function resetHoneyTokens(userId: string, users: Record<string, any>) {
  setHoneySettings(userId, { tokens: [], repeatOnEntry: true }, users);
}

/**
 * Execute Honey Points strategy for the user (auto buy/sell by stages)
 */
export async function executeHoneyStrategy(
  userId: string,
  users: Record<string, any>,
  getPrice: (address: string) => Promise<number>,
  autoBuy: (address: string, amount: number, secret: string) => Promise<string>,
  autoSell: (address: string, amount: number, secret: string) => Promise<string>
) {
  const user = users[userId];
  if (!user || !user.secret) throw new Error('Wallet not found');
  const settings = getHoneySettings(userId, users);
  // Filter tokens according to user settings
  const filteredTokens = settings.tokens.filter(token => {
  // Example: Filter by volume and age (can be expanded for other fields)
    if (typeof token.volume !== 'undefined' && user.strategy?.minVolume && token.volume < user.strategy.minVolume) return false;
    if (typeof token.ageMinutes !== 'undefined' && user.strategy?.minAge && token.ageMinutes < user.strategy.minAge) return false;
    return true;
  });
  for (const token of filteredTokens) {
    // Ignore tokens with missing essential data
    if (!token.address || !token.buyAmount || !Array.isArray(token.profitPercents) || !Array.isArray(token.soldPercents) || token.profitPercents.length === 0 || token.soldPercents.length === 0) {
      token.status = 'error';
      continue;
    }
    if (token.finished) {
      token.status = 'sold';
      continue;
    }
    let currentPrice: number;
    try {
      currentPrice = await getPrice(token.address);
    } catch (e) {
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
            const { JUPITER_QUOTE_API } = require('./src/config');
            const axios = require('axios');
            const mint = token.address;
            if (needJupiter && JUPITER_QUOTE_API) {
              const amountUsd = finalStrategy.minJupiterUsd || 50;
              const lamports = Math.floor((amountUsd / 1) * 1e9);
              try {
                const url = `${JUPITER_QUOTE_API}?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippage=1`;
                const r = await axios.get(url, { timeout: 5000 });
                (token as any).jupiter = r.data;
                const swap = Number(r.data?.swapUsdValue || 0);
                if (typeof finalStrategy.minJupiterUsd === 'number' && swap < finalStrategy.minJupiterUsd) {
                  token.status = 'error';
                  await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'Jupiter liquidity below threshold' });
                  continue;
                }
                if (finalStrategy.requireJupiterRoute === true && !(r.data?.routePlan || r.data?.data)) {
                  token.status = 'error';
                  await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'No Jupiter route' });
                  continue;
                }
              } catch (e) {
                // treat as not meeting requirements
                token.status = 'error';
                await recordUserTrade(userId, { mode: 'buy', token: token.address, amount: token.buyAmount, status: 'fail', error: 'Jupiter check failed' });
                continue;
              }
            }
            // Optional pump enrichment (non-blocking)
            try { const p = await require('./src/pump/api').getCoinData(token.address); (token as any).pump = p; } catch (e) {}
          } catch (e) {}
        }
        const solBalance = await getSolBalance(user.secret);
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
      } catch (e) {
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
      if (
        currentPrice >= target &&
        (!token.lastSellPrice || currentPrice > token.lastSellPrice)
      ) {
        const sellAmount = token.buyAmount * (token.soldPercents[i] / 100);
        try {
          const solBalance = await getSolBalance(user.secret);
          if (solBalance < sellAmount + 0.002) {
            token.status = 'error';
            await recordUserTrade(userId, {
              mode: 'sell',
              token: token.address,
              amount: sellAmount,
              sellPrice: currentPrice,
              status: 'fail',
              error: 'Insufficient SOL balance for sell and fees',
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
        } catch (e) {
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
    if (
      totalSold >= 100 &&
      settings.repeatOnEntry &&
      currentPrice <= (token.lastEntryPrice ?? 0)
    ) {
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