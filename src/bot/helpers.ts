import path from 'path';
import fs from 'fs';
const fsp = fs.promises;

// Simple per-file write queue to serialize writes and avoid races
const writeQueues: Record<string, Promise<void>> = {};

export function writeJsonFile(filePath: string, obj: any) {
  const data = JSON.stringify(obj, null, 2);
  writeQueues[filePath] = (writeQueues[filePath] || Promise.resolve()).then(() => {
    return fsp.writeFile(filePath, data, 'utf8');
  }).catch((err) => {
    console.error('Error writing file', filePath, err);
  });
  return writeQueues[filePath];
}
/**
 * تحقق هل المستخدم اشترى العملة مسبقًا ولم يبعها بعد
 */
export async function hasPendingBuy(userId: string, tokenAddress: string): Promise<boolean> {
  if (!userId || userId === 'undefined') {
    console.warn('[hasPendingBuy] Invalid userId, skipping check.');
    return false;
  }
  const sentTokensDir = path.join(process.cwd(), 'sent_tokens');
  const userFile = path.join(sentTokensDir, `${userId}.json`);
  try {
    const stat = await fsp.stat(userFile).catch(() => false);
    if (!stat) return false;
    const data = await fsp.readFile(userFile, 'utf8');
    const userTrades = JSON.parse(data || '[]');
    return userTrades.some((t: any) => t.mode === 'buy' && t.token === tokenAddress && t.status === 'success' &&
      !userTrades.some((s: any) => s.mode === 'sell' && s.token === tokenAddress && s.status === 'success'));
  } catch {
    return false;
  }
}
import { Markup } from 'telegraf';

export function getErrorMessage(e: any): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e.message) return e.message;
  return JSON.stringify(e);
}

export function limitHistory(user: any, max = 50) {
  if (user && Array.isArray(user.history) && user.history.length > max) {
    user.history = user.history.slice(-max);
  }
}

export function hasWallet(user: any): boolean {
  return !!(user && user.wallet && user.secret);
}

export function walletKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Restore Wallet', 'restore_wallet')],
    [Markup.button.callback('🆕 Create Wallet', 'create_wallet')]
  ]);
}

export async function loadUsers(): Promise<Record<string, any>> {
  try {
    const stat = await fsp.stat('users.json').catch(() => false);
    if (stat) {
      const data = await fsp.readFile('users.json', 'utf8');
      return JSON.parse(data || '{}');
    }
  } catch (e) { console.error('Error loading users.json:', e); }
  return {};
}

// backward-compatible synchronous loader (for scripts that call it sync)
export function loadUsersSync(): Record<string, any> {
  try {
    if (fs.existsSync('users.json')) {
      return JSON.parse(fs.readFileSync('users.json', 'utf8'));
    }
  } catch (e) { console.error('Error loading users.json (sync):', e); }
  return {};
}

export function saveUsers(users: Record<string, any>) {
  try {
    // enqueue async write, do not block caller
    writeJsonFile('users.json', users).catch((e) => console.error('saveUsers error:', e));
  } catch (e) {
    console.error('Error saving users.json:', e);
  }
}