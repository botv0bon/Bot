"use strict";
// tradeSources.ts
//
// هذا الملف يحتوي على دالتي unifiedBuy و unifiedSell فقط.
// كل دالة تستقبل عنوان العملة، الكمية، وسر المستخدم وتنفذ عملية شراء أو بيع آمنة عبر Jupiter مع محاكاة قبل التنفيذ.
// يجب استدعاء كل دالة بشكل منفرد لكل مستخدم حسب استراتيجيته.
// مثال الاستخدام:
//   await unifiedBuy(mint, amount, userSecret);
//   await unifiedSell(mint, amount, userSecret);
Object.defineProperty(exports, "__esModule", { value: true });
exports.unifiedBuy = unifiedBuy;
exports.unifiedSell = unifiedSell;
const jupiter_transaction_sender_1 = require("./utils/jupiter.transaction.sender");
const web3_js_1 = require("@solana/web3.js");
async function unifiedBuy(mint, amount, userSecret) {
    try {
        const tx = await (0, jupiter_transaction_sender_1.sendJupiterTransaction)({ mint, amount, userSecret, side: "buy" });
        if (!tx || !tx.serializedTx)
            throw new Error("لم يتم توليد المعاملة");
        const connection = new web3_js_1.Connection("https://api.mainnet-beta.solana.com");
        const vt = web3_js_1.VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(tx.serializedTx, "base64")));
        const sim = await connection.simulateTransaction(vt);
        if (sim.value.err) {
            return { simulationError: sim.value.err };
        }
        const result = await tx.send();
        return { tx: result?.tx };
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
async function unifiedSell(mint, amount, userSecret) {
    try {
        const tx = await (0, jupiter_transaction_sender_1.sendJupiterTransaction)({ mint, amount, userSecret, side: "sell" });
        if (!tx || !tx.serializedTx)
            throw new Error("لم يتم توليد المعاملة");
        const connection = new web3_js_1.Connection("https://api.mainnet-beta.solana.com");
        const vt = web3_js_1.VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(tx.serializedTx, "base64")));
        const sim = await connection.simulateTransaction(vt);
        if (sim.value.err) {
            return { simulationError: sim.value.err };
        }
        const result = await tx.send();
        return { tx: result?.tx };
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
