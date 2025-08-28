"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReferralWalletAddress = getReferralWalletAddress;
const fs_1 = __importDefault(require("fs"));
const fsp = fs_1.default.promises;
const path_1 = __importDefault(require("path"));
/**
 * Extract referral wallet address for a user from sent_tokens folder
 * @param userId - Telegram user ID or unique user identifier
 * @returns wallet address or null
 */
async function getReferralWalletAddress(userId) {
    if (!userId)
        return null;
    const sentTokensDir = path_1.default.join(process.cwd(), 'sent_tokens');
    const userFile = path_1.default.join(sentTokensDir, `${userId}.json`);
    try {
        const stat = await fsp.stat(userFile).catch(() => false);
        if (!stat)
            return null;
        const userTrades = JSON.parse(await fsp.readFile(userFile, 'utf8'));
        for (const trade of userTrades) {
            if (trade.referrer_wallet)
                return trade.referrer_wallet;
            if (trade.wallet)
                return trade.wallet;
            if (trade.referralWallet)
                return trade.referralWallet;
        }
    }
    catch { }
    return null;
}
