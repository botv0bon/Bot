import { getConnection } from './wallet';
import { PublicKey } from '@solana/web3.js';

export async function getSolBalance(address: string): Promise<number> {
  const conn = getConnection();
  try {
    const pubkey = new PublicKey(address);
    const lamports = await conn.getBalance(pubkey);
    return lamports / 1e9;
  } catch (e) {
    return 0;
  }
}
