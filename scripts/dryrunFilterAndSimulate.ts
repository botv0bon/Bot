// Dry-run filter+simulation using local .env and repo code (SAFE MODE)
// This script WILL NOT call tx.send() or broadcast a transaction. It only simulates the Jupiter transaction and on-chain simulation step.
require('dotenv').config();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { Connection, VersionedTransaction } = require('@solana/web3.js');

(async function main(){
  try {
    const DEX_ENDPOINT = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS || process.env.DEXSCREENER_API_ENDPOINT || 'https://api.dexscreener.com/token-boosts/latest/v1';
    console.log('Using Dex endpoint:', DEX_ENDPOINT);
    console.log('Building strategy: filter #1 -> volume >= $3000');
    const strategy = { minVolume: 3000, minAge: 0, enabled: true };

    // Fetch tokens via tokenUtils.fetchDexScreenerTokens if available, else call dex endpoint
    let tokens = [];
    try {
      const tokenUtils = require('../src/utils/tokenUtils');
      if (typeof tokenUtils.fetchDexScreenerTokens === 'function') {
        tokens = await tokenUtils.fetchDexScreenerTokens('solana', { limit: '200' });
        console.log('Fetched tokens via tokenUtils:', tokens.length);
      }
    } catch (e) {
      console.warn('tokenUtils fetch not available locally, falling back to direct dex call');
    }

    if (tokens.length === 0) {
      const res = await axios.get(DEX_ENDPOINT);
      tokens = Array.isArray(res.data) ? res.data : (res.data?.tokens || []);
      console.log('Fetched tokens from endpoint, count:', tokens.length);
    }

    const { filterTokensByStrategy } = require('../src/bot/strategy');
    const filtered = filterTokensByStrategy(tokens, strategy);
    console.log('Filtered tokens matching volume >= $3000:', filtered.length);
    const sample = filtered.slice(0, 5);
    console.log('Sample tokens:', sample.map(t => ({ address: t.tokenAddress || t.address || t.pairAddress || 'N/A', price: t.priceUsd || t.price || t.priceUsd })));

    if (sample.length === 0) {
      console.log('No tokens match filter; exiting.');
      return;
    }
    const token = sample[0];
    // get sol price
    let solprice = 0;
    try { solprice = Number((await require('../src/utils/tokenUtils').fetchSolanaFromCoinGecko())?.priceUsd || 0); } catch (e) { solprice = Number(process.env.SOL_PRICE || 0); }
    if (!solprice || isNaN(solprice) || solprice <= 0) {
      console.warn('Could not determine SOL price locally, defaulting to 100');
      solprice = 100;
    }
    const usdVolume = 3000;
    const solAmount = Number((usdVolume / solprice).toFixed(6));
    console.log(`Simulating buy of $${usdVolume} -> ${solAmount} SOL (SOL price $${solprice}) for token ${token.tokenAddress || token.address || token.pairAddress}`);

    // SAFE SIMULATION: use repo's sendJupiterTransaction to build the transaction and run connection.simulateTransaction
    let sj;
    try {
      sj = require('../src/utils/jupiter.transaction.sender').sendJupiterTransaction;
    } catch (e) {
      console.error('sendJupiterTransaction not available in repo at ../src/utils/jupiter.transaction.sender. Aborting safe simulation.');
      return;
    }

    try {
      const mintAddr = token.tokenAddress || token.address || token.pairAddress || '';
      console.log('Building Jupiter transaction (simulation only) for mint:', mintAddr);
      const txObj = await sj({ mint: mintAddr, amount: solAmount, userSecret: process.env.PRIVATE_KEY || '', side: 'buy' });
      if (!txObj || !txObj.serializedTx) {
        console.error('sendJupiterTransaction did not return a serializedTx. Response:', txObj);
        return;
      }
      const rpc = process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpc);
      const vt = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(txObj.serializedTx, 'base64')));
      console.log('Running connection.simulateTransaction (this only simulates execution, does not broadcast)');
      const sim = await connection.simulateTransaction(vt);
      console.log('Simulation result:', JSON.stringify(sim && sim.value ? sim.value : sim, null, 2));
      if (sim?.value?.err) {
        console.warn('Simulation reported an error. Inspect above `Simulation result`.');
      } else {
        console.log('Simulation succeeded (no on-chain broadcast performed). You may now inspect the quote and decide to run a real trade locally.');
      }
    } catch (e) {
      console.error('Error during safe simulation:', e?.message || e);
    }

  } catch (e) {
    console.error('Dry-run failed:', e?.message || e);
  }
})();
