import { Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
// حذف الاستيراد المكرر لـ Connection
import fetch from "node-fetch";

/**
 * دالة موحدة لإرسال معاملة شراء أو بيع عبر Jupiter
 * @param params { mint, amount, userSecret, side }
 * @returns { serializedTx, send }
 */
export async function sendJupiterTransaction({ mint, amount, userSecret, side }: { mint: string; amount: number; userSecret: string; side: "buy" | "sell" }) {
  // إعداد الاتصال والمفاتيح
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const secretKey = Uint8Array.from(Buffer.from(userSecret, "base64"));
  const keypair = Keypair.fromSecretKey(secretKey);
  const userPublicKey = keypair.publicKey.toBase58();
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  // تحديد اتجاه العملية
  const inputMint = side === "buy" ? SOL_MINT : mint;
  const outputMint = side === "buy" ? mint : SOL_MINT;
  // جلب عرض السعر من Jupiter
  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount * 1e9)}&slippageBps=100`;
  const quoteRes = await fetch(quoteUrl);
  const quoteJson = await quoteRes.json();
  const quote = (quoteJson as any).data || quoteJson;
  if (!quote || !quote.routePlan || !quote.outAmount) throw new Error("No route found for this token");
  // تجهيز طلب swap
  const swapRequest = {
    userPublicKey,
    wrapAndUnwrapSol: true,
    asLegacyTransaction: false,
    quoteResponse: quote,
  };
  // جلب المعاملة من Jupiter
  const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(swapRequest),
  });
  const swapJson = await swapRes.json();
  const swap = (swapJson as any).data || swapJson;
  if (!swap || !swap.swapTransaction) throw new Error("Failed to get swap transaction from Jupiter");
  const serializedTx = swap.swapTransaction;
  // دالة send لإرسال المعاملة فعليًا
  return {
    serializedTx,
    async send() {
      const vt = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(serializedTx, "base64")));
      vt.sign([keypair]);
      const txid = await connection.sendTransaction(vt, { skipPreflight: true });
      return { tx: txid };
    }
  };
}
import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  TransactionExpiredBlockheightExceededError,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import promiseRetry from "promise-retry";
import { wait } from "./wait";

type TransactionSenderAndConfirmationWaiterArgs = {
  connection: Connection;
  serializedTransaction: Buffer;
  blockhashWithExpiryBlockHeight: BlockhashWithExpiryBlockHeight;
};

const SEND_OPTIONS = {
  skipPreflight: true,
};

export async function transactionSenderAndConfirmationWaiter({
  connection,
  serializedTransaction,
  blockhashWithExpiryBlockHeight,
}: TransactionSenderAndConfirmationWaiterArgs): Promise<VersionedTransactionResponse | null> {
  const txid = await connection.sendRawTransaction(
    serializedTransaction,
    SEND_OPTIONS
  );

  const controller = new AbortController();
  const abortSignal = controller.signal;

  const abortableResender = async () => {
    while (true) {
      await wait(2_000);
      if (abortSignal.aborted) return;
      try {
        await connection.sendRawTransaction(
          serializedTransaction,
          SEND_OPTIONS
        );
      } catch (e) {
        console.warn(`Failed to resend transaction: ${e}`);
      }
    }
  };

  try {
    abortableResender();
    const lastValidBlockHeight =
      blockhashWithExpiryBlockHeight.lastValidBlockHeight - 150;

    // this would throw TransactionExpiredBlockheightExceededError
    await Promise.race([
      connection.confirmTransaction(
        {
          ...blockhashWithExpiryBlockHeight,
          lastValidBlockHeight,
          signature: txid,
          abortSignal,
        },
        "confirmed"
      ),
      new Promise(async (resolve) => {
        // in case ws socket died
        while (!abortSignal.aborted) {
          await wait(2_000);
          const tx = await connection.getSignatureStatus(txid, {
            searchTransactionHistory: false,
          });
          if (tx?.value?.confirmationStatus === "confirmed") {
            resolve(tx);
          }
        }
      }),
    ]);
  } catch (e) {
    if (e instanceof TransactionExpiredBlockheightExceededError) {
      // we consume this error and getTransaction would return null
      return null;
    } else {
      // invalid state from web3.js
      throw e;
    }
  } finally {
    controller.abort();
  }

  // in case rpc is not synced yet, we add some retries
  const response = promiseRetry(
    async (retry: any) => {
      const response = await connection.getTransaction(txid, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!response) {
        retry(response);
      }
      return response;
    },
    {
      retries: 5,
      minTimeout: 1e3,
    }
  );

  return response;
}