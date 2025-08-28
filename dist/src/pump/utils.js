"use strict";
// Deprecated: All logic moved to telegramBot.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeyPairFromPrivateKey = getKeyPairFromPrivateKey;
exports.createTransaction = createTransaction;
exports.sendAndConfirmTransactionWrapper = sendAndConfirmTransactionWrapper;
exports.bufferFromUInt64 = bufferFromUInt64;
const web3_js_1 = require("@solana/web3.js");
const web3_js_2 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
async function getKeyPairFromPrivateKey(key) {
    return web3_js_1.Keypair.fromSecretKey(new Uint8Array(bs58_1.default.decode(key)));
}
async function createTransaction(connection, instructions, payer, priorityFeeInSol = 0) {
    const modifyComputeUnits = web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({
        units: 1400000,
    });
    const transaction = new web3_js_2.Transaction().add(modifyComputeUnits);
    if (priorityFeeInSol > 0) {
        const microLamports = priorityFeeInSol * 1000000000; // convert SOL to microLamports
        const addPriorityFee = web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
            microLamports,
        });
        transaction.add(addPriorityFee);
    }
    transaction.add(...instructions);
    transaction.feePayer = payer;
    transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    return transaction;
}
async function sendAndConfirmTransactionWrapper(connection, transaction, signers) {
    try {
        const signature = await (0, web3_js_2.sendAndConfirmTransaction)(connection, transaction, signers, { skipPreflight: true, preflightCommitment: "confirmed" });
        console.log("Transaction confirmed with signature:", signature);
        return signature;
    }
    catch (error) {
        console.error("Error sending transaction:", error);
        return null;
    }
}
function bufferFromUInt64(value) {
    const arr = new Uint8Array(8);
    let val = BigInt(value);
    for (let i = 0; i < 8; i++) {
        arr[i] = Number((val >> BigInt(8 * i)) & BigInt(0xff));
    }
    return arr;
}
