



import { fetchDexScreenerTokens } from './src/utils/tokenUtils';
import { saveUsers } from './src/bot/helpers';
import { unifiedBuy, unifiedSell } from './src/tradeSources';

/**
 * Entry point for market monitoring and user notifications
 */
function registerWsNotifications(bot: any, users: Record<string, any>) {
  async function pollAndNotify() {
    try {
      // Fetch only Solana tokens, limit to 100, and filter by min liquidity at API level if supported
      const tokens = await fetchDexScreenerTokens('solana', { limit: '100' });
      // Filter tokens: exclude tokens with low liquidity or marked as scam
      // Still filter for scam tokens locally
      const filteredTokens = tokens.filter((token: any) => {
        const notScam = !(token.baseToken?.symbol?.toLowerCase().includes('scam') || token.baseToken?.name?.toLowerCase().includes('scam'));
        return notScam;
      });

      // Import required functions
  const { buildTokenMessage } = await import('./src/utils/tokenUtils');
  const { filterTokensByStrategy } = await import('./src/bot/strategy');
  const { normalizeStrategy } = await import('./src/utils/strategyNormalizer');
      const { extractTradeMeta } = await import('./src/utils/tradeMeta');

      // Import hash and sent-tokens helpers from fastTokenFetcher
      const { hashTokenAddress, readSentHashes, appendSentHash } = await import('./src/fastTokenFetcher');

      for (const userId of Object.keys(users)) {
        const user = users[userId];
        // Robustly check user, wallet, and strategy
        if (!user || !user.wallet || !user.secret || !user.strategy || !user.strategy.enabled) continue;
  // Normalize user's strategy then filter tokens for that user
  const normStrategy = normalizeStrategy(user.strategy);
  let userTokens = filterTokensByStrategy(filteredTokens, normStrategy);
        // Exclude tokens already sent to this user
        const sentHashes = await readSentHashes(userId);
        userTokens = userTokens.filter(token => {
          const addr = token.pairAddress || token.address || token.tokenAddress || '';
          const hash = hashTokenAddress(addr);
          return !sentHashes.has(hash);
        });
        if (!userTokens || userTokens.length === 0) continue;
        // Limit number of tokens sent (e.g. first 10)
        const limitedTokens = userTokens.slice(0, 10);
        const botUsername = bot.botInfo?.username || process.env.BOT_USERNAME || 'YourBotUsername';
        for (const token of limitedTokens) {
          const addr = token.pairAddress || token.address || token.tokenAddress || '';
          const hash = hashTokenAddress(addr);
          const { msg, inlineKeyboard } = buildTokenMessage(token, botUsername, addr);
          // --- AUTO-BUY/SELL/STOP-LOSS LOGIC ---
          try {
            const buyAmount = Number(user.strategy.buyAmount);
              if (!isNaN(buyAmount) && buyAmount > 0 && user.strategy.autoBuy !== false) {
              // Only buy if not already bought (not in sentHashes)
                // Final hard-check against normalized strategy before autoBuy
                const finalStrategy = normalizeStrategy(user.strategy);
                const finalOk = filterTokensByStrategy([token], finalStrategy);
                if (!finalOk || finalOk.length === 0) {
                  // skip buy - token does not meet user's strategy anymore
                  continue;
                }
                const result = await unifiedBuy(addr, buyAmount, user.secret);
                const { fee, slippage } = extractTradeMeta(result, 'buy');
                const resSource = (result as any)?.source ?? 'unknown';
                const resTx = (result as any)?.tx ?? '';
              if (!user.history) user.history = [];
              user.history.push(`AutoBuy: ${addr} | Amount: ${buyAmount} SOL | Source: ${resSource} | Tx: ${resTx} | Fee: ${fee ?? 'N/A'} | Slippage: ${slippage ?? 'N/A'}`);
              saveUsers(users);
              let buyMsg = `✅ <b>AutoBuy Executed</b>\nToken: <code>${addr}</code>\nAmount: <b>${buyAmount}</b> SOL\nSource: <b>${resSource}</b>`;
              if (resTx) buyMsg += `\n<a href='https://solscan.io/tx/${resTx}'>View Tx</a>`;
              if (fee != null) buyMsg += `\nFee: <b>${fee}</b>`;
              if (slippage != null) buyMsg += `\nSlippage: <b>${slippage}</b>`;
              await bot.telegram.sendMessage(userId, buyMsg, { parse_mode: 'HTML', disable_web_page_preview: false });

              // --- AUTO-SELL/STOP-LOSS LOGIC ---
              const buyPrice = Number(token.priceUsd || token.price || 0);
              const profitTargetPercent = Number(user.strategy.profitTargetPercent || user.strategy.sellPercent1 || 0);
              const stopLossPercent = Number(user.strategy.stopLossPercent || 0);
              let sold = false;
              let pollCount = 0;
              const maxPolls = 60; // e.g. check for 1 hour (60 min)
              while (!sold && pollCount < maxPolls) {
                await new Promise(res => setTimeout(res, 60 * 1000)); // 1 min
                pollCount++;
                // Fetch latest price
                const freshTokens = await fetchDexScreenerTokens('solana', { limit: '100' });
                const fresh = freshTokens.find((t: any) => (t.pairAddress || t.address || t.tokenAddress || '') === addr);
                if (!fresh) continue;
                const currentPrice = Number(fresh.priceUsd || fresh.price || 0);
                if (!currentPrice || !buyPrice) continue;
                const changePercent = ((currentPrice - buyPrice) / buyPrice) * 100;
                // Check profit target
                if (profitTargetPercent && changePercent >= profitTargetPercent) {
                    try {
                    const sellResult = await unifiedSell(addr, buyAmount, user.secret);
                    const { fee: sellFee, slippage: sellSlippage } = extractTradeMeta(sellResult, 'sell');
                    const sellSource = (sellResult as any)?.source ?? 'unknown';
                    const sellTx = (sellResult as any)?.tx ?? '';
                    user.history.push(`AutoSell: ${addr} | Amount: ${buyAmount} SOL | Source: ${sellSource} | Tx: ${sellTx} | Fee: ${sellFee ?? 'N/A'} | Slippage: ${sellSlippage ?? 'N/A'}`);
                    saveUsers(users);
                    let sellMsg = `💰 <b>AutoSell (Profit Target) Executed</b>\nToken: <code>${addr}</code>\nProfit: <b>${changePercent.toFixed(2)}%</b>`;
                    if (sellTx) sellMsg += `\n<a href='https://solscan.io/tx/${sellTx}'>View Tx</a>`;
                    if (sellFee != null) sellMsg += `\nFee: <b>${sellFee}</b>`;
                    if (sellSlippage != null) sellMsg += `\nSlippage: <b>${sellSlippage}</b>`;
                    await bot.telegram.sendMessage(userId, sellMsg, { parse_mode: 'HTML', disable_web_page_preview: false });
                    sold = true;
                    break;
                  } catch (err) {
                    await bot.telegram.sendMessage(userId, `❌ <b>AutoSell Failed</b>\nToken: <code>${addr}</code>\nError: ${(err as Error).message || err}`, { parse_mode: 'HTML' });
                  }
                }
                // Check stop loss
                if (stopLossPercent && changePercent <= -Math.abs(stopLossPercent)) {
                    try {
                    const sellResult = await unifiedSell(addr, buyAmount, user.secret);
                    const { fee: sellFee, slippage: sellSlippage } = extractTradeMeta(sellResult, 'sell');
                    const sellSource = (sellResult as any)?.source ?? 'unknown';
                    const sellTx = (sellResult as any)?.tx ?? '';
                    user.history.push(`AutoSell (StopLoss): ${addr} | Amount: ${buyAmount} SOL | Source: ${sellSource} | Tx: ${sellTx} | Fee: ${sellFee ?? 'N/A'} | Slippage: ${sellSlippage ?? 'N/A'}`);
                    saveUsers(users);
                    let sellMsg = `🛑 <b>AutoSell (Stop Loss) Executed</b>\nToken: <code>${addr}</code>\nLoss: <b>${changePercent.toFixed(2)}%</b>`;
                    if (sellTx) sellMsg += `\n<a href='https://solscan.io/tx/${sellTx}'>View Tx</a>`;
                    if (sellFee != null) sellMsg += `\nFee: <b>${sellFee}</b>`;
                    if (sellSlippage != null) sellMsg += `\nSlippage: <b>${sellSlippage}</b>`;
                    await bot.telegram.sendMessage(userId, sellMsg, { parse_mode: 'HTML', disable_web_page_preview: false });
                    sold = true;
                    break;
                  } catch (err) {
                    await bot.telegram.sendMessage(userId, `❌ <b>AutoSell (Stop Loss) Failed</b>\nToken: <code>${addr}</code>\nError: ${(err as Error).message || err}`, { parse_mode: 'HTML' });
                  }
                }
              }
              // --- END AUTO-SELL/STOP-LOSS LOGIC ---
            }
          } catch (err) {
            await bot.telegram.sendMessage(userId, `❌ <b>AutoBuy Failed</b>\nToken: <code>${addr}</code>\nError: ${(err as Error).message || err}`, { parse_mode: 'HTML' });
          }
          // --- END AUTO-BUY/SELL/STOP-LOSS LOGIC ---
          if (msg && typeof msg === 'string') {
            try {
              await bot.telegram.sendMessage(userId, msg, {
                parse_mode: 'HTML',
                disable_web_page_preview: false,
                reply_markup: { inline_keyboard: inlineKeyboard }
              });
              await appendSentHash(userId, hash);
            } catch (err) {
              console.error(`Failed to send message to user ${userId}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in pollAndNotify:', err);
    }
  }
  setInterval(pollAndNotify, 60 * 1000);
  pollAndNotify();
}

export { registerWsNotifications };