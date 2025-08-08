import { filterTokensByStrategy } from './bot/strategy';
import { unifiedBuy, unifiedSell } from './tradeSources';

/**
 * Executes auto-trading for a user based on their strategy.
 * @param user - User object containing strategy, wallet, and secret
 * @param tokens - Array of available tokens to filter and trade
 * @param mode - 'buy' or 'sell'
 */
export async function autoExecuteStrategyForUser(user: any, tokens: any[], mode: 'buy' | 'sell' = 'buy') {
  if (!user.strategy || !user.wallet || !user.secret || user.strategy.enabled === false) return;

  // Filter tokens according to user's strategy
  const filteredTokens = filterTokensByStrategy(tokens, user.strategy);
  if (filteredTokens.length === 0) {
    console.log(`[autoExecute] No tokens matched for user ${user.id || user.username}`);
    return;
  }

  for (const token of filteredTokens) {
    try {
      // Prevent duplicate trades for same token (optional: add your own logic)
      // Example: if (user.sentHashes?.has(token.mint)) continue;

      // Execute auto buy/sell
      let result;
      if (mode === 'buy') {
        result = await unifiedBuy(token.mint, user.strategy.buyAmount || 0.1, user.secret);
      } else {
        result = await unifiedSell(token.mint, user.strategy.sellAmount || 0.1, user.secret);
      }
      console.log(`[autoExecute] ${mode} for user ${user.id || user.username} on token ${token.mint}:`, result);
      // Optionally: log, notify user, update history, etc.
    } catch (err) {
      console.error(`[autoExecute] Failed to ${mode} token ${token.mint} for user ${user.id || user.username}:`, err);
    }
  }
}
