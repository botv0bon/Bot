import fs from 'fs';
const fsp = fs.promises;
import path from 'path';

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
