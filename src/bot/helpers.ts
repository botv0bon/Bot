import path from 'path';
// listener-only guard to avoid disk I/O in hot paths
const LISTENER_ONLY_MODE = String(process.env.LISTENER_ONLY_MODE ?? process.env.LISTENER_ONLY ?? 'true').toLowerCase() === 'true';
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
    // In listener-only mode avoid disk access; use in-memory fallback store
    if (LISTENER_ONLY_MODE) {
      try {
        if (!(global as any).__inMemorySentTokens) (global as any).__inMemorySentTokens = new Map<string, any[]>();
        const store: Map<string, any[]> = (global as any).__inMemorySentTokens;
        const userTrades = store.get(userId) || [];
        return (userTrades || []).some((t: any) => t.mode === 'buy' && t.token === tokenAddress && t.status === 'success' &&
          !(userTrades || []).some((s: any) => s.mode === 'sell' && s.token === tokenAddress && s.status === 'success'));
      } catch (e) { return false; }
    }
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

/**
 * Load users and return a sanitized map suitable for external use/UI.
 * This wraps `loadUsers()` and applies `publicUsers` to the result.
 */
export async function loadPublicUsers(opts?: { removeSecret?: boolean, trimHistory?: boolean, maxHistory?: number }) {
  const users = await loadUsers();
  return publicUsers(users, opts);
}

/**
 * Synchronous version of `loadPublicUsers` that reads from disk and sanitizes.
 */
export function loadPublicUsersSync(opts?: { removeSecret?: boolean, trimHistory?: boolean, maxHistory?: number }) {
  const users = loadUsersSync();
  return publicUsers(users, opts);
}

export function saveUsers(users: Record<string, any>) {
  try {
    // enqueue async write, do not block caller
    writeJsonFile('users.json', users).catch((e) => console.error('saveUsers error:', e));
  } catch (e) {
    console.error('Error saving users.json:', e);
  }
}

/**
 * Produce a sanitized copy of a user object suitable for external return/UI.
 * By default this removes sensitive fields (secret/private_key) and trims history.
 * Options:
 *  - removeSecret: boolean (default true) - strip private keys
 *  - trimHistory: boolean (default true) - keep only the last `maxHistory` entries
 *  - maxHistory: number (default 10)
 */
export function publicUser(user: Record<string, any> | undefined | null, opts?: { removeSecret?: boolean, trimHistory?: boolean, maxHistory?: number }) {
  if (!user) return null;
  const { removeSecret = true, trimHistory = true, maxHistory = 10 } = opts || {};
  // shallow copy
  const u: Record<string, any> = { ...user };
  // normalize common id fields
  if (!u.id && (u.userId || u.telegramId)) u.id = u.userId || u.telegramId;
  // remove sensitive fields
  if (removeSecret) {
    delete u.secret;
    delete u.private_key;
    delete u.privateKey;
    delete u._secret;
  }
  // trim history for UI safety
  if (trimHistory && Array.isArray(u.history)) {
    u.history = u.history.slice(-Math.max(0, Number(maxHistory)));
  }
  return u;
}

/**
 * Sanitize a map of users. Returns a shallow copy map with each user passed through `publicUser`.
 */
export function publicUsers(users: Record<string, any> | undefined | null, opts?: { removeSecret?: boolean, trimHistory?: boolean, maxHistory?: number }) {
  if (!users || typeof users !== 'object') return {};
  const out: Record<string, any> = {};
  for (const k of Object.keys(users)) {
    try {
      out[k] = publicUser(users[k], opts);
    } catch (e) {
      out[k] = null;
    }
  }
  return out;
}