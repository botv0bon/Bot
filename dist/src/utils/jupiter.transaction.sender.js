"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendJupiterTransaction = sendJupiterTransaction;
exports.transactionSenderAndConfirmationWaiter = transactionSenderAndConfirmationWaiter;
const web3_js_1 = require("@solana/web3.js");
// حذف الاستيراد المكرر لـ Connection
const node_fetch_1 = __importDefault(require("node-fetch"));
/**
 * دالة موحدة لإرسال معاملة شراء أو بيع عبر Jupiter
 * @param params { mint, amount, userSecret, side }
 * @returns { serializedTx, send }
 */
async function sendJupiterTransaction({ mint, amount, userSecret, side }) {
    // إعداد الاتصال والمفاتيح
    const connection = new web3_js_2.Connection("https://api.mainnet-beta.solana.com");
    const secretKey = Uint8Array.from(Buffer.from(userSecret, "base64"));
    const keypair = web3_js_1.Keypair.fromSecretKey(secretKey);
    const userPublicKey = keypair.publicKey.toBase58();
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    // تحديد اتجاه العملية
    const inputMint = side === "buy" ? SOL_MINT : mint;
    const outputMint = side === "buy" ? mint : SOL_MINT;
    // جلب عرض السعر من Jupiter
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount * 1e9)}&slippageBps=100`;
    const quoteRes = await (0, node_fetch_1.default)(quoteUrl);
    const quoteJson = await quoteRes.json();
    const quote = quoteJson.data || quoteJson;
    if (!quote || !quote.routePlan || !quote.outAmount)
        throw new Error("No route found for this token");
    // تجهيز طلب swap
    const swapRequest = {
        userPublicKey,
        wrapAndUnwrapSol: true,
        asLegacyTransaction: false,
        quoteResponse: quote,
    };
    // جلب المعاملة من Jupiter
    const swapRes = await (0, node_fetch_1.default)("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(swapRequest),
    });
    const swapJson = await swapRes.json();
    const swap = swapJson.data || swapJson;
    if (!swap || !swap.swapTransaction)
        throw new Error("Failed to get swap transaction from Jupiter");
    const serializedTx = swap.swapTransaction;
    // دالة send لإرسال المعاملة فعليًا
    return {
        serializedTx,
        async send() {
            const vt = web3_js_1.VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(serializedTx, "base64")));
            vt.sign([keypair]);
            const txid = await connection.sendTransaction(vt, { skipPreflight: true });
            return { tx: txid };
        }
    };
}
const web3_js_2 = require("@solana/web3.js");
const promise_retry_1 = __importDefault(require("promise-retry"));
const wait_1 = require("./wait");
const SEND_OPTIONS = {
    skipPreflight: true,
};
async function transactionSenderAndConfirmationWaiter({ connection, serializedTransaction, blockhashWithExpiryBlockHeight, }) {
    const txid = await connection.sendRawTransaction(serializedTransaction, SEND_OPTIONS);
    const controller = new AbortController();
    const abortSignal = controller.signal;
    const abortableResender = async () => {
        while (true) {
            await (0, wait_1.wait)(2000);
            if (abortSignal.aborted)
                return;
            try {
                await connection.sendRawTransaction(serializedTransaction, SEND_OPTIONS);
            }
            catch (e) {
                console.warn(`Failed to resend transaction: ${e}`);
            }
        }
    };
    try {
        abortableResender();
        const lastValidBlockHeight = blockhashWithExpiryBlockHeight.lastValidBlockHeight - 150;
        // this would throw TransactionExpiredBlockheightExceededError
        await Promise.race([
            connection.confirmTransaction({
                ...blockhashWithExpiryBlockHeight,
                lastValidBlockHeight,
                signature: txid,
                abortSignal,
            }, "confirmed"),
            new Promise(async (resolve) => {
                // in case ws socket died
                while (!abortSignal.aborted) {
                    await (0, wait_1.wait)(2000);
                    const tx = await connection.getSignatureStatus(txid, {
                        searchTransactionHistory: false,
                    });
                    if (tx?.value?.confirmationStatus === "confirmed") {
                        resolve(tx);
                    }
                }
            }),
        ]);
    }
    catch (e) {
        if (e instanceof web3_js_2.TransactionExpiredBlockheightExceededError) {
            // we consume this error and getTransaction would return null
            return null;
        }
        else {
            // invalid state from web3.js
            throw e;
        }
    }
    finally {
        controller.abort();
    }
    // in case rpc is not synced yet, we add some retries
    const response = (0, promise_retry_1.default)(async (retry) => {
        const response = await connection.getTransaction(txid, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        if (!response) {
            retry(response);
        }
        return response;
    }, {
        retries: 5,
        minTimeout: 1e3,
    });
    return response;
}
