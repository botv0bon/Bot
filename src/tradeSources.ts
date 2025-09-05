// tradeSources.ts
//   await unifiedBuy(mint, amount, userSecret);
//   await unifiedSell(mint, amount, userSecret);

import { sendJupiterTransaction } from "./utils/jupiter.transaction.sender";
import { VersionedTransaction, Connection } from "@solana/web3.js";

const AUTO_EXEC_SANDBOX = (process.env.AUTO_EXEC_SANDBOX === 'true');

export async function unifiedBuy(mint: string, amount: number, userSecret: string): Promise<{ tx?: string; simulationError?: any; error?: string }> {
	try {
		if(AUTO_EXEC_SANDBOX){
			// Sandbox mode: do not send transactions; return simulated tx id
			const fake = `sandbox-buy-${mint.slice(0,6)}-${Date.now()}`;
			console.error(`[SANDBOX unifiedBuy] simulated tx=${fake} mint=${mint} amount=${amount}`);
			return { tx: fake };
		}
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
		if(AUTO_EXEC_SANDBOX){
			const fake = `sandbox-sell-${mint.slice(0,6)}-${Date.now()}`;
			console.error(`[SANDBOX unifiedSell] simulated tx=${fake} mint=${mint} amount=${amount}`);
			return { tx: fake };
		}
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
