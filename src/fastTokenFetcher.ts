import axios from 'axios';
import { filterTokensByStrategy } from './bot/strategy';
import { normalizeStrategy } from './utils/strategyNormalizer';
import { registerBuyWithTarget } from './bot/strategy';
import { extractTradeMeta } from './utils/tradeMeta';
import { unifiedBuy } from './tradeSources';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { saveUsers } from './bot/helpers';
import path from 'path';

type UsersMap = Record<string, any>;

const DEXBOOSTS = process.env.DEXSCREENER_API_ENDPOINT || 'https://api.dexscreener.com/token-boosts/latest/v1';

export function hashTokenAddress(addr: string) {
  return String(addr || '').toLowerCase().trim();
}

function ensureSentDir() {
  const sent = path.join(process.cwd(), 'sent_tokens');
  if (!existsSync(sent)) mkdirSync(sent);
  return sent;
}

export function readSentHashes(userId: string): Set<string> {
  try {
    const sentDir = ensureSentDir();
    const file = path.join(sentDir, `${userId}.json`);
    if (!existsSync(file)) return new Set();
    const data = JSON.parse(readFileSync(file, 'utf8')) as any[];
    return new Set((data || []).map(d => d.hash).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

export function appendSentHash(userId: string, hash: string) {
  try {
    const sentDir = ensureSentDir();
    const file = path.join(sentDir, `${userId}.json`);
    let arr: any[] = [];
    if (existsSync(file)) {
      try { arr = JSON.parse(readFileSync(file, 'utf8')) || []; } catch {}
    }
    arr.push({ hash, time: Date.now() });
    writeFileSync(file, JSON.stringify(arr.slice(-500), null, 2));
  } catch (e) {}
}

/**
 * Start fast polling of DexScreener boosts endpoint and prioritize users flagged in their strategy.
 * Prioritized users: user.strategy.priority === true or user.strategy.priorityRank > 0
 */
export function startFastTokenFetcher(users: UsersMap, telegram: any, options?: { intervalMs?: number }) {
  const intervalMs = options?.intervalMs || 1000;
  let running = true;

  async function loop() {
    while (running) {
      try {
        const res = await axios.get(DEXBOOSTS, { timeout: 5000 });
        const data = res.data;
        let tokens: any[] = [];
        if (Array.isArray(data)) tokens = data;
        else if (Array.isArray(data.boosts)) tokens = data.boosts;
        else if (Array.isArray(data.profiles)) tokens = data.profiles;

        if (!tokens.length) {
          await sleep(intervalMs);
          continue;
        }

        // Build prioritized users list (normalize strategy per user)
        const prioritized: string[] = [];
        for (const uid of Object.keys(users)) {
          const u = users[uid];
          if (!u || !u.strategy) continue;
          const norm = normalizeStrategy(u.strategy);
          if (!norm || norm.enabled === false) continue;
          // replace temporarily for use below
          u.__normalizedStrategy = norm;
          if (norm.priority === true || (norm.priorityRank && norm.priorityRank > 0)) prioritized.push(uid);
        }

        // Process tokens and attempt notify/buy for prioritized users first
        for (const token of tokens) {
          // Normalize token address field candidates
          const addr = token.tokenAddress || token.address || token.mint || token.pairAddress || token.pair?.address || '';
          if (!addr) continue;
          for (const uid of prioritized) {
            const user = users[uid];
            // Skip invalid users
            if (!user || !user.secret || !user.strategy || !user.strategy.enabled) continue;
            // Skip if already sent
            const sent = readSentHashes(uid);
            const h = hashTokenAddress(addr);
            if (sent.has(h)) continue;
            // Run filtering for this single token using normalized strategy
            try {
              const strategyToUse = user.__normalizedStrategy || normalizeStrategy(user.strategy);
              const ok = filterTokensByStrategy([token], strategyToUse);
              if (ok && ok.length) {
                // Notify user (simple message)
                try {
                  const msg = `🚀 Priority token matched: ${token.description || token.name || addr}\nAddress: ${addr}`;
                  await telegram.sendMessage(uid, msg);
                } catch (e) {}
                appendSentHash(uid, h);
                // Optionally auto-buy if enabled and buyAmount > 0
                if (user.strategy.autoBuy !== false && Number(user.strategy.buyAmount) > 0) {
                  try {
                    // Final hard-check: ensure token still passes the user's normalized strategy
                    const finalStrategy = user.__normalizedStrategy || normalizeStrategy(user.strategy);
                    const finalOk = filterTokensByStrategy([token], finalStrategy);
                    if (!finalOk || finalOk.length === 0) {
                      // token no longer matches strategy -> skip autoBuy
                      continue;
                    }
                    const amount = Number(user.strategy.buyAmount);
                    const result = await unifiedBuy(addr, amount, user.secret);
                    if (result && ((result as any).tx || (result as any).success)) {
                      // register buy entry if available
                      try { registerBuyWithTarget(user, { address: addr, price: token.price || token.priceUsd }, result, user.strategy.targetPercent || 10); } catch {}
                      // extract fee/slippage
                      const { fee, slippage } = extractTradeMeta(result, 'buy');
                      // save a light history entry including fee/slippage
                      user.history = user.history || [];
                      const resTx = (result as any)?.tx ?? '';
                      user.history.push(`PriorityAutoBuy: ${addr} | ${amount} SOL | Tx: ${resTx} | Fee: ${fee ?? 'N/A'} | Slippage: ${slippage ?? 'N/A'}`);
                      // send a lightweight telegram notification for priority auto-buy
                      try {
                        let msg = `✅ <b>Priority AutoBuy Executed</b>\nToken: ${token.description || token.name || addr}\nAddress: ${addr}\nAmount: <b>${amount}</b> SOL`;
                        if (resTx) msg += `\n<a href='https://solscan.io/tx/${resTx}'>View Tx</a>`;
                        if (fee != null) msg += `\nFee: <b>${fee}</b>`;
                        if (slippage != null) msg += `\nSlippage: <b>${slippage}</b>`;
                        await telegram.sendMessage(uid, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
                      } catch (e) {}
                      // persist users to disk
                      try { saveUsers(users); } catch (e) {}
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {
              // ignore per-user filter errors
            }
          }
        }
      } catch (err) {
        // ignore fetch errors
      }
      await sleep(intervalMs);
    }
  }

  loop();

  return {
    stop: () => { running = false; }
  };
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
