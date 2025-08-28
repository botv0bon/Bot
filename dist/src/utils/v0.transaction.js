"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSignatureStatus = void 0;
exports.sendTransactionV0 = sendTransactionV0;
const web3_js_1 = require("@solana/web3.js");
const get_signature_1 = require("./get.signature");
const jupiter_transaction_sender_1 = require("./jupiter.transaction.sender");
const wait_1 = require("./wait");
const config_1 = require("../config");
const COMMITMENT_LEVEL = 'confirmed';
async function sendTransactionV0(connection, instructions, payers) {
    let latestBlockhash = await connection
        .getLatestBlockhash(COMMITMENT_LEVEL);
    const messageV0 = new web3_js_1.TransactionMessage({
        payerKey: payers[0].publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
    }).compileToV0Message();
    const transaction = new web3_js_1.VersionedTransaction(messageV0);
    transaction.sign(payers);
    const signature = (0, get_signature_1.getSignature)(transaction);
    // We first simulate whether the transaction would be successful
    const { value: simulatedTransactionResponse } = await connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        commitment: "processed",
    });
    const { err, logs } = simulatedTransactionResponse;
    if (err) {
        // Simulation error, we can check the logs for more details
        // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
        console.error("Simulation Error:");
        console.error({ err, logs });
        return null;
    }
    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;
    const transactionResponse = await (0, jupiter_transaction_sender_1.transactionSenderAndConfirmationWaiter)({
        connection,
        serializedTransaction,
        blockhashWithExpiryBlockHeight: {
            blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
    });
    // If we are not getting a response back, the transaction has not confirmed.
    if (!transactionResponse) {
        console.error("Transaction not confirmed");
        return null;
    }
    if (transactionResponse.meta?.err) {
        console.error(transactionResponse.meta?.err);
        return null;
    }
    return signature;
}
const getSignatureStatus = async (signature) => {
    try {
        const maxRetry = 30;
        let retries = 0;
        while (retries < maxRetry) {
            await (0, wait_1.wait)(1000);
            retries++;
            const tx = await config_1.connection.getSignatureStatus(signature, {
                searchTransactionHistory: false,
            });
            if (tx?.value?.err) {
                console.log("JitoTransaction Failed");
                break;
            }
            if (tx?.value?.confirmationStatus === "confirmed" || tx?.value?.confirmationStatus === "finalized") {
                retries = 0;
                console.log("JitoTransaction confirmed!!!");
                break;
            }
        }
        if (retries > 0)
            return false;
        return true;
    }
    catch (e) {
        return false;
    }
};
exports.getSignatureStatus = getSignatureStatus;
