import {
  ApiClmmPoolsItem,
  jsonInfo2PoolKeys,
  Clmm,
  TokenAccount,
  SPL_ACCOUNT_LAYOUT,
  fetchMultipleMintInfos,
  Percent,
  Token,
  TokenAmount,
  Liquidity,
  LiquidityPoolKeys,
  TOKEN_PROGRAM_ID,
  MAINNET_PROGRAM_ID as PROGRAMIDS,
  ApiPoolInfoV4,
  LiquidityPoolInfo,
  LiquidityPoolStatus,
} from "@raydium-io/raydium-sdk";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  createTransferInstruction,
} from "@solana/spl-token";
import { private_connection } from "../config";
import { RESERVE_WALLET } from "../config";
import { getSignature } from "../utils/get.signature";
// referral wallet helper not used after fee routing changes
import { formatClmmKeysById } from "./utils/formatClmmKeysById";
import { formatAmmKeysById } from "./utils/formatAmmKeysById";

import { default as BN, min } from "bn.js";

// runtime service fallbacks (some services might be optional or defined elsewhere)
let TokenService: any;
let UserTradeSettingService: any;
let RaydiumTokenService: any;
try { TokenService = require('../services/token.metadata').TokenService; } catch (e) { TokenService = null; }
try { UserTradeSettingService = require('../services/user.trade.setting.service').UserTradeSettingService; } catch (e) { UserTradeSettingService = null; }
try { RaydiumTokenService = require('../services/raydium.token.service').RaydiumTokenService; } catch (e) { RaydiumTokenService = null; }

export const getPriceInSOL = async (tokenAddress: string): Promise<number> => {
  try {
    const tokenPrice = await TokenService.getSPLPrice(tokenAddress);
    const solPrice = await TokenService.getSOLPrice();
    const priceInSol = tokenPrice / solPrice;
    return priceInSol;
  } catch (e) {
    // If an error occurs, return a default value (e.g., 0)
    return 0;
  }
};

export const calcAmountOut = async (
  connection: Connection,
  inMint: PublicKey,
  inDecimal: number,
  outMint: PublicKey,
  outDecimal: number,
  poolId: string,
  rawAmountIn: number,
  isAmm: boolean,
  ammKeys?: any,
  clmmKeys?: any
) => {
  let inAmount = rawAmountIn > 0 ? rawAmountIn : 10000;
  let outAmount = 0;
  let priceImpactPct = 0;
  let priceInSol = 0;

  const slippage = new Percent(100); // 100% slippage
  const currencyIn = new Token(TOKEN_PROGRAM_ID, inMint, inDecimal);
  const amountIn = new TokenAmount(currencyIn, inAmount, false);
  const currencyOut = new Token(TOKEN_PROGRAM_ID, outMint, outDecimal);
  console.log("AMM", isAmm, Date.now());
  if (isAmm) {
    const targetPoolInfo = ammKeys
      ? JSON.parse(JSON.stringify(ammKeys))
      : await syncAmmPoolKeys(poolId);
    if (!targetPoolInfo) {
      console.log("🚀 cannot find the target pool", poolId);
      return;
    }
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;
    // const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });

    const baseReserve = await connection.getTokenAccountBalance(
      new PublicKey(targetPoolInfo.baseVault)
    );
    const quoteReserve = await connection.getTokenAccountBalance(
      new PublicKey(targetPoolInfo.quoteVault)
    );
    const poolInfo: LiquidityPoolInfo = {
      status: new BN(LiquidityPoolStatus.Swap),
      baseDecimals: targetPoolInfo.baseDecimals,
      quoteDecimals: targetPoolInfo.quoteDecimals,
      lpDecimals: targetPoolInfo.lpDecimals,
      baseReserve: new BN(baseReserve.value.amount),
      quoteReserve: new BN(quoteReserve.value.amount),
      lpSupply: new BN("0"),
      startTime: new BN("0"),
    };

    const { amountOut, priceImpact, currentPrice } = Liquidity.computeAmountOut(
      {
        poolKeys,
        poolInfo,
        amountIn,
        currencyOut,
        slippage,
      }
    );

    const decimalsDiff =
      currentPrice.baseCurrency.decimals - currentPrice.quoteCurrency.decimals;
    if (
      (currentPrice.baseCurrency as Token).mint.toBase58() ===
      NATIVE_MINT.toBase58()
    ) {
      priceInSol =
        Number(currentPrice.denominator) /
        Number(currentPrice.numerator) /
        10 ** decimalsDiff;
      console.log(
        "F=>PriceInSOL & OutAmount",
        currentPrice.numerator.toString(),
        currentPrice.denominator.toString()
      );
    } else {
      priceInSol =
        (Number(currentPrice.numerator) / Number(currentPrice.denominator)) *
        10 ** decimalsDiff;
      console.log(
        "S=>PriceInSOL & OutAmount",
        currentPrice.numerator.toString(),
        currentPrice.denominator.toString()
      );
    }

    outAmount = Number(amountOut.numerator) / Number(amountOut.denominator);
    priceImpactPct =
      (100 * Number(priceImpact.numerator)) / Number(priceImpact.denominator);
  } else {
    const clmmPools: ApiClmmPoolsItem[] = [
      clmmKeys
        ? JSON.parse(JSON.stringify(clmmKeys))
        : await syncClmmPoolKeys(poolId),
    ];
    const { [poolId]: clmmPoolInfo } = await Clmm.fetchMultiplePoolInfos({
      connection,
      poolKeys: clmmPools,
      chainTime: new Date().getTime() / 1000,
    });

    const tickCache = await Clmm.fetchMultiplePoolTickArrays({
      connection,
      poolKeys: [clmmPoolInfo.state],
      batchRequest: true,
    });

    const { amountOut, priceImpact, currentPrice } =
      Clmm.computeAmountOutFormat({
        poolInfo: clmmPoolInfo.state,
        tickArrayCache: tickCache[poolId],
        amountIn,
        slippage,
        currencyOut,
        epochInfo: await connection.getEpochInfo(),
        token2022Infos: await fetchMultipleMintInfos({
          connection,
          mints: [
            ...clmmPools
              .map((i) => [
                { mint: i.mintA, program: i.mintProgramIdA },
                { mint: i.mintB, program: i.mintProgramIdB },
              ])
              .flat()
              .filter((i) => i.program === TOKEN_2022_PROGRAM_ID.toString())
              .map((i) => new PublicKey(i.mint)),
          ],
        }),
        catchLiquidityInsufficient: true,
      });
    const decimalsDiff =
      currentPrice.baseCurrency.decimals - currentPrice.quoteCurrency.decimals;
    if (
      (currentPrice.baseCurrency as Token).mint.toBase58() ===
      NATIVE_MINT.toBase58()
    ) {
      priceInSol =
        Number(currentPrice.denominator) /
        Number(currentPrice.numerator) /
        10 ** decimalsDiff;
      console.log(
        "FF=>PriceInSOL & OutAmount",
        currentPrice.numerator.toString(),
        currentPrice.denominator.toString()
      );
    } else {
      priceInSol =
        (Number(currentPrice.numerator) / Number(currentPrice.denominator)) *
        10 ** decimalsDiff;
      console.log(
        "SS=>PriceInSOL & OutAmount",
        currentPrice.numerator.toString(),
        currentPrice.denominator.toString()
      );
    }

    outAmount =
      Number(amountOut.amount.numerator) / Number(amountOut.amount.denominator);
    priceImpactPct =
      (100 * Number(priceImpact.numerator)) / Number(priceImpact.denominator);
  }
  console.log("1PriceInSOL & OutAmount", priceInSol, outAmount);
  return {
    inputMint: inMint.toString(),
    inAmount: rawAmountIn,
    outputMint: outMint.toString(),
    outAmount,
    priceImpactPct,
    priceInSol,
  };
};

export class RaydiumSwapService {
  constructor() {}

  async swapToken(
    pk: string,
    inputMint: string,
    outputMint: string,
    decimal: number,
    _amount: number,
    _slippage: number,
    gasFee: number,
    isFeeBurn: boolean,
    username: string,
    isToken2022: boolean
  ) {
    try {
      // JitoFee
      const jitoFeeSetting = await UserTradeSettingService.getJitoFee(username);
      const jitoFeeValue =
        UserTradeSettingService.getJitoFeeValue(jitoFeeSetting);

      let total_fee_in_sol = 0;
      let total_fee_in_token = 0;
      const is_buy = inputMint === NATIVE_MINT.toString();
      const mint = is_buy ? outputMint : inputMint;

      let total_fee_percent = 0.01; // 1%
      let total_fee_percent_in_sol = 0.01; // 1%
      let total_fee_percent_in_token = 0;

      if (isFeeBurn) {
        total_fee_percent_in_sol = 0.0075;
        total_fee_percent_in_token =
          total_fee_percent - total_fee_percent_in_sol;
      }
      const fee =
        _amount *
        (is_buy ? total_fee_percent_in_sol : total_fee_percent_in_token);

      const inDecimal = is_buy ? 9 : decimal;
      const outDecimal = is_buy ? decimal : 9;
      // in_amount
      const amount = Number(((_amount - fee) * 10 ** inDecimal).toFixed(0));
      const wallet = Keypair.fromSecretKey(bs58.decode(pk));

      // معالجة عدم توفر RaydiumTokenService: استخدم بيانات poolinfo مباشرة أو أضف منطق بديل
      const poolinfo = null; // أو استخدم دالة بديلة لجلب بيانات المسبح
      if (!poolinfo) return;
      const { isAmm, poolId, ammKeys, clmmKeys } = poolinfo;

      const connection = private_connection;
      // const tokenPrice = await getPriceInSOL(mint);
      // const quoteAmount = is_buy
      //   ? (amount * 10 ** (outDecimal - inDecimal)) / tokenPrice
      //   : amount * tokenPrice * 10 ** (outDecimal - inDecimal);

      // معالجة عدم توفر QuoteRes: استخدم النوع any مؤقتاً
      const quote = (await calcAmountOut(
        connection,
        new PublicKey(inputMint),
        inDecimal,
        new PublicKey(outputMint),
        outDecimal,
        poolId,
        amount / 10 ** inDecimal,
        isAmm,
        ammKeys,
        clmmKeys
      )) as any;

      if (!quote) {
        console.error("unable to quote");
        return;
      }
      const quoteAmount = Number(quote.outAmount) * 10 ** outDecimal;
      if (is_buy) {
        total_fee_in_sol = Number((fee * 10 ** inDecimal).toFixed(0));
        total_fee_in_token = Number(
          (quoteAmount * total_fee_percent_in_token).toFixed(0)
        );
      } else {
        total_fee_in_token = Number((fee * 10 ** inDecimal).toFixed(0));
        total_fee_in_sol = Number(
          (quoteAmount * total_fee_percent_in_sol).toFixed(0)
        );
      }

      const tokenAccountIn = getAssociatedTokenAddressSync(
        new PublicKey(inputMint),
        wallet.publicKey,
        true
      );
      const tokenAccountOut = getAssociatedTokenAddressSync(
        new PublicKey(outputMint),
        wallet.publicKey,
        true
      );

      const inputToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey(inputMint),
        inDecimal
      );
      const inputTokenAmount = new TokenAmount(
        inputToken,
        new BN(amount.toString(), 10)
      );

      const outputToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey(outputMint),
        outDecimal
      );

      const targetPool = poolId;
      const slippage = new Percent(_slippage);
      let raydiumSwapInnerInstruction;
      if (isAmm) {
        // -------- pre-action: get pool info --------
        const targetPoolInfo = ammKeys
          ? JSON.parse(JSON.stringify(ammKeys))
          : await syncAmmPoolKeys(poolId); // await formatAmmKeysById(targetPool);
        if (!targetPoolInfo) {
          console.log("🚀 cannot find the target pool", 11);
          return;
        }
        const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;

        // -------- step 2: create instructions by SDK function --------
        const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
          {
            poolKeys,
            userKeys: {
              tokenAccountIn,
              tokenAccountOut,
              owner: wallet.publicKey,
            },
            amountIn: amount,
            minAmountOut: new BN(0),
          },
          poolKeys.version
        );
        console.log("SELL", amount, tokenAccountIn, tokenAccountOut);
        raydiumSwapInnerInstruction = innerTransaction;
      } else {
        // -------- pre-action: get pool info --------
        const clmmPools: ApiClmmPoolsItem[] = [
          clmmKeys
            ? JSON.parse(JSON.stringify(clmmKeys))
            : await syncClmmPoolKeys(poolId),
          // await formatClmmKeysById(targetPool),
        ];
        const { [targetPool]: clmmPoolInfo } =
          await Clmm.fetchMultiplePoolInfos({
            connection,
            poolKeys: clmmPools,
            chainTime: new Date().getTime() / 1000,
          });

        // -------- step 1: fetch tick array --------
        const tickCache = await Clmm.fetchMultiplePoolTickArrays({
          connection,
          poolKeys: [clmmPoolInfo.state],
          batchRequest: true,
        });

        // -------- step 2: calc amount out by SDK function --------
        // Configure input/output parameters, in this example, this token amount will swap 0.0001 USDC to RAY
        const { minAmountOut, remainingAccounts } = Clmm.computeAmountOutFormat(
          {
            poolInfo: clmmPoolInfo.state,
            tickArrayCache: tickCache[targetPool],
            amountIn: inputTokenAmount,
            currencyOut: outputToken,
            slippage,
            epochInfo: await connection.getEpochInfo(),
            token2022Infos: await fetchMultipleMintInfos({
              connection,
              mints: [
                ...clmmPools
                  .map((i) => [
                    { mint: i.mintA, program: i.mintProgramIdA },
                    { mint: i.mintB, program: i.mintProgramIdB },
                  ])
                  .flat()
                  .filter((i) => i.program === TOKEN_2022_PROGRAM_ID.toString())
                  .map((i) => new PublicKey(i.mint)),
              ],
            }),
            catchLiquidityInsufficient: true,
          }
        );
        const tokenAccountA = getAssociatedTokenAddressSync(
          NATIVE_MINT,
          wallet.publicKey,
          true
        );
        const tokenAccountB = getAssociatedTokenAddressSync(
          new PublicKey(mint),
          wallet.publicKey,
          true
        );

        // -------- step 3: create instructions by SDK function --------
        const { innerTransaction } = Clmm.makeSwapBaseInInstructions({
          poolInfo: clmmPoolInfo.state,
          ownerInfo: {
            wallet: wallet.publicKey,
            tokenAccountA,
            tokenAccountB,
          },
          inputMint: inputTokenAmount.token.mint,
          amountIn: inputTokenAmount.raw,
          amountOutMin: new BN(0),
          sqrtPriceLimitX64: new BN(0),
          remainingAccounts,
        });
        raydiumSwapInnerInstruction = innerTransaction;
      }

      const jitoFeeValueWei = BigInt((jitoFeeValue * 10 ** 9).toFixed());
      // // Gas in SOL
      const cu = 1_000_000;
      const microLamports = calculateMicroLamports(gasFee, cu);

      console.log("Fee====>", microLamports, gasFee, cu);
      console.log("Is_BUY", is_buy);
      const instructions: TransactionInstruction[] = is_buy
        ? [
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: microLamports,
            }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
            // JitoTipOption
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: wallet.publicKey,
              lamports: jitoFeeValueWei,
            }),
            createAssociatedTokenAccountIdempotentInstruction(
              wallet.publicKey,
              tokenAccountIn,
              wallet.publicKey,
              NATIVE_MINT
            ),
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: tokenAccountIn,
              lamports: amount,
            }),
            createSyncNativeInstruction(tokenAccountIn, TOKEN_PROGRAM_ID),
            createAssociatedTokenAccountIdempotentInstruction(
              wallet.publicKey,
              tokenAccountOut,
              wallet.publicKey,
              new PublicKey(mint)
            ),
            ...raydiumSwapInnerInstruction.instructions,
            // Unwrap WSOL for SOL
            createCloseAccountInstruction(
              tokenAccountIn,
              wallet.publicKey,
              wallet.publicKey
            ),
          ]
        : [
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: microLamports,
            }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
            // JitoTipOption
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: wallet.publicKey,
              lamports: jitoFeeValueWei,
            }),
            createAssociatedTokenAccountIdempotentInstruction(
              wallet.publicKey,
              tokenAccountOut,
              wallet.publicKey,
              NATIVE_MINT
            ),
            ...raydiumSwapInnerInstruction.instructions,
            // Unwrap WSOL for SOL
            createCloseAccountInstruction(
              tokenAccountOut,
              wallet.publicKey,
              wallet.publicKey
            ),
          ];

      console.log(
        "🚀 Quote ~",
        quoteAmount,
        total_fee_in_sol,
        total_fee_in_token
      );

      // Route all fees to BOT_WALLET_ADDRESS (no external referral split)
      console.log("Before Fee routing: ", Date.now());
      const botWalletAddr = process.env.BOT_WALLET_ADDRESS;
      if (!botWalletAddr) console.warn('BOT_WALLET_ADDRESS not set; fees will not be routed to bot.');
      const totalSolFees = Number(total_fee_in_sol || 0);
      if (totalSolFees > 0 && botWalletAddr) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(botWalletAddr),
            lamports: totalSolFees,
          })
        );
      }
      // Route token fees to bot ATA
      if (total_fee_in_token && total_fee_in_token > 0 && botWalletAddr) {
        try {
          const mintPubkey = new PublicKey(is_buy ? outputMint : inputMint);
          const botPub = new PublicKey(botWalletAddr);
          const botAta = getAssociatedTokenAddressSync(mintPubkey, botPub, true);
          const ownerAta = getAssociatedTokenAddressSync(mintPubkey, wallet.publicKey, true);
          instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, botAta, botPub, mintPubkey));
          instructions.push(createTransferInstruction(ownerAta, botAta, wallet.publicKey, Number(total_fee_in_token), [], TOKEN_PROGRAM_ID));
        } catch (e) {
          console.warn('Failed to route token fees to bot ATA in raydium swap:', (e as any)?.message || e);
        }
      }
      console.log("After Fee routing: ", Date.now());

      const { blockhash, lastValidBlockHeight } =
        await private_connection.getLatestBlockhash();

      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      // transaction.sign([wallet]);
      transaction.sign([wallet, ...raydiumSwapInnerInstruction.signers]);
      // Sign the transaction
      const signature = getSignature(transaction);

      // We first simulate whether the transaction would be successful
      const { value: simulatedTransactionResponse } =
        await private_connection.simulateTransaction(transaction, {
          replaceRecentBlockhash: true,
          commitment: "processed",
        });
      const { err, logs } = simulatedTransactionResponse;

      console.log("🚀 Simulate ~", Date.now());
      // if (!err) return;

      if (err) {
        // Simulation error, we can check the logs for more details
        // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
        console.error("Simulation Error:");
        console.error({ err, logs });
        return;
      }

      const rawTransaction = transaction.serialize();
      // if (rawTransaction) return;
      return {
        quote: { inAmount: amount, outAmount: quoteAmount },
        signature,
        total_fee_in_sol,
        total_fee_in_token,
      };
    } catch (e) {
      console.log("SwapToken Failed", e);
      return null;
    }
  }
}

export async function getWalletTokenAccount(
  connection: Connection,
  wallet: PublicKey
): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i: any) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

export const calculateMicroLamports = (gasvalue: number, cu: number) => {
  const microlamports = ((gasvalue - 0.000005) * (10 ** 15 / cu)).toFixed(0);
  return Number(microlamports);
};

export const syncAmmPoolKeys = async (poolId: string) => {
  console.log("syncAmmPoolKeys");
  // const tokenInfo = await RaydiumTokenService.findLastOne({
  //   poolId: poolId
  // });
  // if (tokenInfo) {
  // if (tokenInfo.ammKeys) return tokenInfo.ammKeys;
  const poolKeys = await formatAmmKeysById(poolId);
  const filter = { poolId };
  const data = { ammKeys: poolKeys };
  await RaydiumTokenService.findOneAndUpdate({ filter, data });
  return poolKeys;
  // }
};

export const syncClmmPoolKeys = async (poolId: string) => {
  console.log("syncClmmPoolKeys");

  // const tokenInfo = await RaydiumTokenService.findLastOne({
  //   poolId: poolId
  // });
  // if (tokenInfo) {
  //   if (tokenInfo.clmmKeys) return tokenInfo.clmmKeys;
  const poolKeys = await formatClmmKeysById(poolId);
  const filter = { poolId };
  const data = { clmmKeys: poolKeys };
  await RaydiumTokenService.findOneAndUpdate({ filter, data });
  return poolKeys;
  // }
};
