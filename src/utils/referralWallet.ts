import fs from 'fs';
const fsp = fs.promises;
import path from 'path';
const LISTENER_ONLY_MODE = String(process.env.LISTENER_ONLY_MODE ?? process.env.LISTENER_ONLY ?? 'true').toLowerCase() === 'true';

/**
 * Extract referral wallet address for a user from sent_tokens folder
 * @param userId - Telegram user ID or unique user identifier
 * @returns wallet address or null
 */
export async function getReferralWalletAddress(userId: string): Promise<string | null> {
  if (!userId) return null;
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  try {
    if (LISTENER_ONLY_MODE) {
      try {
        if (!(global as any).__inMemorySentTokens) (global as any).__inMemorySentTokens = new Map<string, any[]>();
        const store: Map<string, any[]> = (global as any).__inMemorySentTokens;
        const userTrades = store.get(userId) || [];
        for (const trade of userTrades) {
          if (trade.referrer_wallet) return trade.referrer_wallet;
          if (trade.wallet) return trade.wallet;
          if (trade.referralWallet) return trade.referralWallet;
        }
        return null;
      } catch (e) { return null; }
    }
    const stat = await fsp.stat(userFile).catch(() => false);
    if (!stat) return null;
    const userTrades = JSON.parse(await fsp.readFile(userFile, 'utf8'));
    for (const trade of userTrades) {
      if (trade.referrer_wallet) return trade.referrer_wallet;
      if (trade.wallet) return trade.wallet;
      if (trade.referralWallet) return trade.referralWallet;
    }
  } catch {}
  return null;
}
