"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJsonFile = writeJsonFile;
exports.hasPendingBuy = hasPendingBuy;
exports.getErrorMessage = getErrorMessage;
exports.limitHistory = limitHistory;
exports.hasWallet = hasWallet;
exports.walletKeyboard = walletKeyboard;
exports.loadUsers = loadUsers;
exports.loadUsersSync = loadUsersSync;
exports.loadPublicUsers = loadPublicUsers;
exports.loadPublicUsersSync = loadPublicUsersSync;
exports.saveUsers = saveUsers;
exports.publicUser = publicUser;
exports.publicUsers = publicUsers;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const fsp = fs_1.default.promises;
// Simple per-file write queue to serialize writes and avoid races
const writeQueues = {};
function writeJsonFile(filePath, obj) {
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
async function hasPendingBuy(userId, tokenAddress) {
    if (!userId || userId === 'undefined') {
        console.warn('[hasPendingBuy] Invalid userId, skipping check.');
        return false;
    }
    const sentTokensDir = path_1.default.join(process.cwd(), 'sent_tokens');
    const userFile = path_1.default.join(sentTokensDir, `${userId}.json`);
    try {
        const stat = await fsp.stat(userFile).catch(() => false);
        if (!stat)
            return false;
        const data = await fsp.readFile(userFile, 'utf8');
        const userTrades = JSON.parse(data || '[]');
        return userTrades.some((t) => t.mode === 'buy' && t.token === tokenAddress && t.status === 'success' &&
            !userTrades.some((s) => s.mode === 'sell' && s.token === tokenAddress && s.status === 'success'));
    }
    catch {
        return false;
    }
}
const telegraf_1 = require("telegraf");
function getErrorMessage(e) {
    if (!e)
        return 'Unknown error';
    if (typeof e === 'string')
        return e;
    if (e.message)
        return e.message;
    return JSON.stringify(e);
}
function limitHistory(user, max = 50) {
    if (user && Array.isArray(user.history) && user.history.length > max) {
        user.history = user.history.slice(-max);
    }
}
function hasWallet(user) {
    return !!(user && user.wallet && user.secret);
}
function walletKeyboard() {
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('🔑 Restore Wallet', 'restore_wallet')],
        [telegraf_1.Markup.button.callback('🆕 Create Wallet', 'create_wallet')]
    ]);
}
async function loadUsers() {
    try {
        const stat = await fsp.stat('users.json').catch(() => false);
        if (stat) {
            const data = await fsp.readFile('users.json', 'utf8');
            return JSON.parse(data || '{}');
        }
    }
    catch (e) {
        console.error('Error loading users.json:', e);
    }
    return {};
}
// backward-compatible synchronous loader (for scripts that call it sync)
function loadUsersSync() {
    try {
        if (fs_1.default.existsSync('users.json')) {
            return JSON.parse(fs_1.default.readFileSync('users.json', 'utf8'));
        }
    }
    catch (e) {
        console.error('Error loading users.json (sync):', e);
    }
    return {};
}
/**
 * Load users and return a sanitized map suitable for external use/UI.
 * This wraps `loadUsers()` and applies `publicUsers` to the result.
 */
async function loadPublicUsers(opts) {
    const users = await loadUsers();
    return publicUsers(users, opts);
}
/**
 * Synchronous version of `loadPublicUsers` that reads from disk and sanitizes.
 */
function loadPublicUsersSync(opts) {
    const users = loadUsersSync();
    return publicUsers(users, opts);
}
function saveUsers(users) {
    try {
        // enqueue async write, do not block caller
        writeJsonFile('users.json', users).catch((e) => console.error('saveUsers error:', e));
    }
    catch (e) {
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
function publicUser(user, opts) {
    if (!user)
        return null;
    const { removeSecret = true, trimHistory = true, maxHistory = 10 } = opts || {};
    // shallow copy
    const u = { ...user };
    // normalize common id fields
    if (!u.id && (u.userId || u.telegramId))
        u.id = u.userId || u.telegramId;
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
function publicUsers(users, opts) {
    if (!users || typeof users !== 'object')
        return {};
    const out = {};
    for (const k of Object.keys(users)) {
        try {
            out[k] = publicUser(users[k], opts);
        }
        catch (e) {
            out[k] = null;
        }
    }
    return out;
}
