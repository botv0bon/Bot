"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSolBalance = getSolBalance;
const wallet_1 = require("./wallet");
const web3_js_1 = require("@solana/web3.js");
async function getSolBalance(address) {
    const conn = (0, wallet_1.getConnection)();
    try {
        const pubkey = new web3_js_1.PublicKey(address);
        const lamports = await conn.getBalance(pubkey);
        return lamports / 1e9;
    }
    catch (e) {
        return 0;
    }
}
