#!/usr/bin/env node
/*
precreate-create-example.js
Usage:
  node scripts/precreate-create-example.js <basePubkey> <seed> <space> <lamports> [--simulate]

Examples:
  # show usage
  node scripts/precreate-create-example.js

  # simulate creating an account derived from basePubkey+seed with 165 bytes and 2039280 lamports
  node scripts/precreate-create-example.js Gp6raMys3nZHFwQEMp2oTV859iNuoXJoXxPmwH7o6iLF myseed 165 2039280 --simulate

Notes:
- This script only simulates (unless you pass a private key via env PRIVATE_KEY as a base58 or JSON array and --execute).
- It will never broadcast by default.
*/

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(0,22).join('\n'));
  process.exit(0);
}

const [baseStr, seed, spaceStr, lamportsStr, flag] = args;
const simulate = args.includes('--simulate') || args.includes('-s');
const execute = args.includes('--execute') || args.includes('-x');

const rpc = process.env.RPC || 'https://api.mainnet-beta.solana.com';

(async function main(){
  let web3;
  try { web3 = require('@solana/web3.js'); } catch (e) { console.error('Please install @solana/web3.js in this repo (npm i @solana/web3.js)'); process.exit(2); }
  const { Connection, PublicKey, SystemProgram, Transaction, Keypair } = web3;

  const base = new PublicKey(baseStr);
  const space = Number(spaceStr || 165);
  const lamports = Number(lamportsStr || 0);
  const programId = SystemProgram.programId; // owner of created account (system program)

  const derived = await PublicKey.createWithSeed(base, seed, programId);
  console.log('Derived pubkey:', derived.toBase58());

  const conn = new Connection(rpc, 'confirmed');
  const info = await conn.getAccountInfo(derived);
  if (info) {
    console.log('Account already exists. owner=', info.owner.toBase58(), 'lamports=', info.lamports);
    process.exit(0);
  }

  console.log('Account does not exist; preparing createAccountWithSeed instruction...');

  // build instruction
  const ix = SystemProgram.createAccountWithSeed({
    fromPubkey: base,
    newAccountPubkey: derived,
    basePubkey: base,
    seed: seed,
    lamports: lamports,
    space: space,
    programId: programId,
  });

  const tx = new Transaction().add(ix);

  if (simulate) {
    // sign with ephemeral keypair to allow simulation
    const payer = Keypair.generate();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const serialized = tx.serialize().toString('base64');
    console.log('Simulating transaction with ephemeral payer (no broadcast)...');
    const res = await conn.simulateTransaction(tx);
    console.log('Simulation result:', JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (execute) {
    // attempt to read PRIVATE_KEY from env (either base58 or JSON array of numbers)
    const pkEnv = process.env.PRIVATE_KEY;
    if (!pkEnv) { console.error('PRIVATE_KEY not set in env; aborting execute.'); process.exit(2); }
    let payer;
    try {
      // try base58
      const bs58 = require('bs58');
      const key = bs58.decode(pkEnv);
      payer = Keypair.fromSecretKey(Uint8Array.from(key));
    } catch (e) {
      try { const arr = JSON.parse(pkEnv); payer = Keypair.fromSecretKey(Uint8Array.from(arr)); } catch (e2) { console.error('Failed to parse PRIVATE_KEY from env; provide base58 or JSON array'); process.exit(3); }
    }
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    console.log('Prepared signed transaction (not auto-sent). Serialized (base64):');
    console.log(tx.serialize().toString('base64'));
    console.log('If you want to send, run:');
    console.log('  // node -e "(async()=>{const web3=require(\'@solana/web3.js\');const conn=new web3.Connection(\''+rpc+'\',\'confirmed\');const txb=Buffer.from(\''+tx.serialize().toString('base64')+'\',\'base64\'); const tx = web3.VersionedTransaction.deserialize(txb); console.log(await conn.sendRawTransaction(txb)); })()"');
    process.exit(0);
  }

  console.log('Dry run: created instruction object. To test simulate add --simulate, to sign/prepare add --execute with PRIVATE_KEY in env (unsafe).');
})();
