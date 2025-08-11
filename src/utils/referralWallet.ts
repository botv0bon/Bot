import fs from 'fs';
import path from 'path';

/**
 * Extract referral wallet address for a user from sent_tokens folder
 * @param userId - Telegram user ID or unique user identifier
 * @returns wallet address or null
 */
export function getReferralWalletAddress(userId: string): string | null {
  if (!userId) return null;
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  if (!fs.existsSync(userFile)) return null;
  try {
    const userTrades = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    // Try to find wallet address in any trade (should be saved in buy/sell or metadata)
    for (const trade of userTrades) {
      if (trade.referrer_wallet) return trade.referrer_wallet;
      if (trade.wallet) return trade.wallet;
      if (trade.referralWallet) return trade.referralWallet;
    }
    // Or add logic to extract from metadata if needed
  } catch {}
  return null;
}
