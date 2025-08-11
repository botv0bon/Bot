// tradeSources.ts
//
// هذا الملف يحتوي على دالتي unifiedBuy و unifiedSell فقط.
// كل دالة تستقبل عنوان العملة، الكمية، وسر المستخدم وتنفذ عملية شراء أو بيع آمنة عبر Jupiter مع محاكاة قبل التنفيذ.
// يجب استدعاء كل دالة بشكل منفرد لكل مستخدم حسب استراتيجيته.
// مثال الاستخدام:
//   await unifiedBuy(mint, amount, userSecret);
//   await unifiedSell(mint, amount, userSecret);

import { sendJupiterTransaction } from "./utils/jupiter.transaction.sender";
import { VersionedTransaction, Connection } from "@solana/web3.js";

export async function unifiedBuy(mint: string, amount: number, userSecret: string): Promise<{ tx?: string; simulationError?: any; error?: string }> {
	try {
		const tx = await sendJupiterTransaction({ mint, amount, userSecret, side: "buy" });
		if (!tx || !tx.serializedTx) throw new Error("لم يتم توليد المعاملة");
		const connection = new Connection("https://api.mainnet-beta.solana.com");
		const vt = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(tx.serializedTx, "base64")));
		const sim = await connection.simulateTransaction(vt);
		if (sim.value.err) {
			return { simulationError: sim.value.err };
		}
		const result = await tx.send();
		return { tx: result?.tx };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

export async function unifiedSell(mint: string, amount: number, userSecret: string): Promise<{ tx?: string; simulationError?: any; error?: string }> {
	try {
		const tx = await sendJupiterTransaction({ mint, amount, userSecret, side: "sell" });
		if (!tx || !tx.serializedTx) throw new Error("لم يتم توليد المعاملة");
		const connection = new Connection("https://api.mainnet-beta.solana.com");
		const vt = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(tx.serializedTx, "base64")));
		const sim = await connection.simulateTransaction(vt);
		if (sim.value.err) {
			return { simulationError: sim.value.err };
		}
		const result = await tx.send();
		return { tx: result?.tx };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
