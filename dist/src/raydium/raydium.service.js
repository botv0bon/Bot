"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncClmmPoolKeys = exports.syncAmmPoolKeys = exports.calculateMicroLamports = exports.RaydiumSwapService = exports.calcAmountOut = exports.getPriceInSOL = void 0;
exports.getWalletTokenAccount = getWalletTokenAccount;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
const spl_token_1 = require("@solana/spl-token");
const config_1 = require("../config");
const get_signature_1 = require("../utils/get.signature");
// referral wallet helper not used after fee routing changes
const formatClmmKeysById_1 = require("./utils/formatClmmKeysById");
const formatAmmKeysById_1 = require("./utils/formatAmmKeysById");
const bn_js_1 = __importDefault(require("bn.js"));
// runtime service fallbacks (some services might be optional or defined elsewhere)
let TokenService;
let UserTradeSettingService;
let RaydiumTokenService;
try {
    TokenService = require('../services/token.metadata').TokenService;
}
catch (e) {
    TokenService = null;
}
try {
    UserTradeSettingService = require('../services/user.trade.setting.service').UserTradeSettingService;
}
catch (e) {
    UserTradeSettingService = null;
}
try {
    RaydiumTokenService = require('../services/raydium.token.service').RaydiumTokenService;
}
catch (e) {
    RaydiumTokenService = null;
}
const getPriceInSOL = async (tokenAddress) => {
    try {
        const tokenPrice = await TokenService.getSPLPrice(tokenAddress);
        const solPrice = await TokenService.getSOLPrice();
        const priceInSol = tokenPrice / solPrice;
        return priceInSol;
    }
    catch (e) {
        // If an error occurs, return a default value (e.g., 0)
        return 0;
    }
};
exports.getPriceInSOL = getPriceInSOL;
const calcAmountOut = async (connection, inMint, inDecimal, outMint, outDecimal, poolId, rawAmountIn, isAmm, ammKeys, clmmKeys) => {
    let inAmount = rawAmountIn > 0 ? rawAmountIn : 10000;
    let outAmount = 0;
    let priceImpactPct = 0;
    let priceInSol = 0;
    const slippage = new raydium_sdk_1.Percent(100); // 100% slippage
    const currencyIn = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, inMint, inDecimal);
    const amountIn = new raydium_sdk_1.TokenAmount(currencyIn, inAmount, false);
    const currencyOut = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, outMint, outDecimal);
    console.log("AMM", isAmm, Date.now());
    if (isAmm) {
        const targetPoolInfo = ammKeys
            ? JSON.parse(JSON.stringify(ammKeys))
            : await (0, exports.syncAmmPoolKeys)(poolId);
        if (!targetPoolInfo) {
            console.log("🚀 cannot find the target pool", poolId);
            return;
        }
        const poolKeys = (0, raydium_sdk_1.jsonInfo2PoolKeys)(targetPoolInfo);
        // const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
        const baseReserve = await connection.getTokenAccountBalance(new web3_js_1.PublicKey(targetPoolInfo.baseVault));
        const quoteReserve = await connection.getTokenAccountBalance(new web3_js_1.PublicKey(targetPoolInfo.quoteVault));
        const poolInfo = {
            status: new bn_js_1.default(raydium_sdk_1.LiquidityPoolStatus.Swap),
            baseDecimals: targetPoolInfo.baseDecimals,
            quoteDecimals: targetPoolInfo.quoteDecimals,
            lpDecimals: targetPoolInfo.lpDecimals,
            baseReserve: new bn_js_1.default(baseReserve.value.amount),
            quoteReserve: new bn_js_1.default(quoteReserve.value.amount),
            lpSupply: new bn_js_1.default("0"),
            startTime: new bn_js_1.default("0"),
        };
        const { amountOut, priceImpact, currentPrice } = raydium_sdk_1.Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut,
            slippage,
        });
        const decimalsDiff = currentPrice.baseCurrency.decimals - currentPrice.quoteCurrency.decimals;
        if (currentPrice.baseCurrency.mint.toBase58() ===
            spl_token_1.NATIVE_MINT.toBase58()) {
            priceInSol =
                Number(currentPrice.denominator) /
                    Number(currentPrice.numerator) /
                    10 ** decimalsDiff;
            console.log("F=>PriceInSOL & OutAmount", currentPrice.numerator.toString(), currentPrice.denominator.toString());
        }
        else {
            priceInSol =
                (Number(currentPrice.numerator) / Number(currentPrice.denominator)) *
                    10 ** decimalsDiff;
            console.log("S=>PriceInSOL & OutAmount", currentPrice.numerator.toString(), currentPrice.denominator.toString());
        }
        outAmount = Number(amountOut.numerator) / Number(amountOut.denominator);
        priceImpactPct =
            (100 * Number(priceImpact.numerator)) / Number(priceImpact.denominator);
    }
    else {
        const clmmPools = [
            clmmKeys
                ? JSON.parse(JSON.stringify(clmmKeys))
                : await (0, exports.syncClmmPoolKeys)(poolId),
        ];
        const { [poolId]: clmmPoolInfo } = await raydium_sdk_1.Clmm.fetchMultiplePoolInfos({
            connection,
            poolKeys: clmmPools,
            chainTime: new Date().getTime() / 1000,
        });
        const tickCache = await raydium_sdk_1.Clmm.fetchMultiplePoolTickArrays({
            connection,
            poolKeys: [clmmPoolInfo.state],
            batchRequest: true,
        });
        const { amountOut, priceImpact, currentPrice } = raydium_sdk_1.Clmm.computeAmountOutFormat({
            poolInfo: clmmPoolInfo.state,
            tickArrayCache: tickCache[poolId],
            amountIn,
            slippage,
            currencyOut,
            epochInfo: await connection.getEpochInfo(),
            token2022Infos: await (0, raydium_sdk_1.fetchMultipleMintInfos)({
                connection,
                mints: [
                    ...clmmPools
                        .map((i) => [
                        { mint: i.mintA, program: i.mintProgramIdA },
                        { mint: i.mintB, program: i.mintProgramIdB },
                    ])
                        .flat()
                        .filter((i) => i.program === spl_token_1.TOKEN_2022_PROGRAM_ID.toString())
                        .map((i) => new web3_js_1.PublicKey(i.mint)),
                ],
            }),
            catchLiquidityInsufficient: true,
        });
        const decimalsDiff = currentPrice.baseCurrency.decimals - currentPrice.quoteCurrency.decimals;
        if (currentPrice.baseCurrency.mint.toBase58() ===
            spl_token_1.NATIVE_MINT.toBase58()) {
            priceInSol =
                Number(currentPrice.denominator) /
                    Number(currentPrice.numerator) /
                    10 ** decimalsDiff;
            console.log("FF=>PriceInSOL & OutAmount", currentPrice.numerator.toString(), currentPrice.denominator.toString());
        }
        else {
            priceInSol =
                (Number(currentPrice.numerator) / Number(currentPrice.denominator)) *
                    10 ** decimalsDiff;
            console.log("SS=>PriceInSOL & OutAmount", currentPrice.numerator.toString(), currentPrice.denominator.toString());
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
exports.calcAmountOut = calcAmountOut;
class RaydiumSwapService {
    constructor() { }
    async swapToken(pk, inputMint, outputMint, decimal, _amount, _slippage, gasFee, isFeeBurn, username, isToken2022) {
        try {
            // JitoFee
            const jitoFeeSetting = await UserTradeSettingService.getJitoFee(username);
            const jitoFeeValue = UserTradeSettingService.getJitoFeeValue(jitoFeeSetting);
            let total_fee_in_sol = 0;
            let total_fee_in_token = 0;
            const is_buy = inputMint === spl_token_1.NATIVE_MINT.toString();
            const mint = is_buy ? outputMint : inputMint;
            let total_fee_percent = 0.01; // 1%
            let total_fee_percent_in_sol = 0.01; // 1%
            let total_fee_percent_in_token = 0;
            if (isFeeBurn) {
                total_fee_percent_in_sol = 0.0075;
                total_fee_percent_in_token =
                    total_fee_percent - total_fee_percent_in_sol;
            }
            const fee = _amount *
                (is_buy ? total_fee_percent_in_sol : total_fee_percent_in_token);
            const inDecimal = is_buy ? 9 : decimal;
            const outDecimal = is_buy ? decimal : 9;
            // in_amount
            const amount = Number(((_amount - fee) * 10 ** inDecimal).toFixed(0));
            const wallet = web3_js_1.Keypair.fromSecretKey(bs58_1.default.decode(pk));
            // معالجة عدم توفر RaydiumTokenService: استخدم بيانات poolinfo مباشرة أو أضف منطق بديل
            const poolinfo = null; // أو استخدم دالة بديلة لجلب بيانات المسبح
            if (!poolinfo)
                return;
            const { isAmm, poolId, ammKeys, clmmKeys } = poolinfo;
            const connection = config_1.private_connection;
            // const tokenPrice = await getPriceInSOL(mint);
            // const quoteAmount = is_buy
            //   ? (amount * 10 ** (outDecimal - inDecimal)) / tokenPrice
            //   : amount * tokenPrice * 10 ** (outDecimal - inDecimal);
            // معالجة عدم توفر QuoteRes: استخدم النوع any مؤقتاً
            const quote = (await (0, exports.calcAmountOut)(connection, new web3_js_1.PublicKey(inputMint), inDecimal, new web3_js_1.PublicKey(outputMint), outDecimal, poolId, amount / 10 ** inDecimal, isAmm, ammKeys, clmmKeys));
            if (!quote) {
                console.error("unable to quote");
                return;
            }
            const quoteAmount = Number(quote.outAmount) * 10 ** outDecimal;
            if (is_buy) {
                total_fee_in_sol = Number((fee * 10 ** inDecimal).toFixed(0));
                total_fee_in_token = Number((quoteAmount * total_fee_percent_in_token).toFixed(0));
            }
            else {
                total_fee_in_token = Number((fee * 10 ** inDecimal).toFixed(0));
                total_fee_in_sol = Number((quoteAmount * total_fee_percent_in_sol).toFixed(0));
            }
            const tokenAccountIn = (0, spl_token_1.getAssociatedTokenAddressSync)(new web3_js_1.PublicKey(inputMint), wallet.publicKey, true);
            const tokenAccountOut = (0, spl_token_1.getAssociatedTokenAddressSync)(new web3_js_1.PublicKey(outputMint), wallet.publicKey, true);
            const inputToken = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, new web3_js_1.PublicKey(inputMint), inDecimal);
            const inputTokenAmount = new raydium_sdk_1.TokenAmount(inputToken, new bn_js_1.default(amount.toString(), 10));
            const outputToken = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, new web3_js_1.PublicKey(outputMint), outDecimal);
            const targetPool = poolId;
            const slippage = new raydium_sdk_1.Percent(_slippage);
            let raydiumSwapInnerInstruction;
            if (isAmm) {
                // -------- pre-action: get pool info --------
                const targetPoolInfo = ammKeys
                    ? JSON.parse(JSON.stringify(ammKeys))
                    : await (0, exports.syncAmmPoolKeys)(poolId); // await formatAmmKeysById(targetPool);
                if (!targetPoolInfo) {
                    console.log("🚀 cannot find the target pool", 11);
                    return;
                }
                const poolKeys = (0, raydium_sdk_1.jsonInfo2PoolKeys)(targetPoolInfo);
                // -------- step 2: create instructions by SDK function --------
                const { innerTransaction } = raydium_sdk_1.Liquidity.makeSwapFixedInInstruction({
                    poolKeys,
                    userKeys: {
                        tokenAccountIn,
                        tokenAccountOut,
                        owner: wallet.publicKey,
                    },
                    amountIn: amount,
                    minAmountOut: new bn_js_1.default(0),
                }, poolKeys.version);
                console.log("SELL", amount, tokenAccountIn, tokenAccountOut);
                raydiumSwapInnerInstruction = innerTransaction;
            }
            else {
                // -------- pre-action: get pool info --------
                const clmmPools = [
                    clmmKeys
                        ? JSON.parse(JSON.stringify(clmmKeys))
                        : await (0, exports.syncClmmPoolKeys)(poolId),
                    // await formatClmmKeysById(targetPool),
                ];
                const { [targetPool]: clmmPoolInfo } = await raydium_sdk_1.Clmm.fetchMultiplePoolInfos({
                    connection,
                    poolKeys: clmmPools,
                    chainTime: new Date().getTime() / 1000,
                });
                // -------- step 1: fetch tick array --------
                const tickCache = await raydium_sdk_1.Clmm.fetchMultiplePoolTickArrays({
                    connection,
                    poolKeys: [clmmPoolInfo.state],
                    batchRequest: true,
                });
                // -------- step 2: calc amount out by SDK function --------
                // Configure input/output parameters, in this example, this token amount will swap 0.0001 USDC to RAY
                const { minAmountOut, remainingAccounts } = raydium_sdk_1.Clmm.computeAmountOutFormat({
                    poolInfo: clmmPoolInfo.state,
                    tickArrayCache: tickCache[targetPool],
                    amountIn: inputTokenAmount,
                    currencyOut: outputToken,
                    slippage,
                    epochInfo: await connection.getEpochInfo(),
                    token2022Infos: await (0, raydium_sdk_1.fetchMultipleMintInfos)({
                        connection,
                        mints: [
                            ...clmmPools
                                .map((i) => [
                                { mint: i.mintA, program: i.mintProgramIdA },
                                { mint: i.mintB, program: i.mintProgramIdB },
                            ])
                                .flat()
                                .filter((i) => i.program === spl_token_1.TOKEN_2022_PROGRAM_ID.toString())
                                .map((i) => new web3_js_1.PublicKey(i.mint)),
                        ],
                    }),
                    catchLiquidityInsufficient: true,
                });
                const tokenAccountA = (0, spl_token_1.getAssociatedTokenAddressSync)(spl_token_1.NATIVE_MINT, wallet.publicKey, true);
                const tokenAccountB = (0, spl_token_1.getAssociatedTokenAddressSync)(new web3_js_1.PublicKey(mint), wallet.publicKey, true);
                // -------- step 3: create instructions by SDK function --------
                const { innerTransaction } = raydium_sdk_1.Clmm.makeSwapBaseInInstructions({
                    poolInfo: clmmPoolInfo.state,
                    ownerInfo: {
                        wallet: wallet.publicKey,
                        tokenAccountA,
                        tokenAccountB,
                    },
                    inputMint: inputTokenAmount.token.mint,
                    amountIn: inputTokenAmount.raw,
                    amountOutMin: new bn_js_1.default(0),
                    sqrtPriceLimitX64: new bn_js_1.default(0),
                    remainingAccounts,
                });
                raydiumSwapInnerInstruction = innerTransaction;
            }
            const jitoFeeValueWei = BigInt((jitoFeeValue * 10 ** 9).toFixed());
            // // Gas in SOL
            const cu = 1000000;
            const microLamports = (0, exports.calculateMicroLamports)(gasFee, cu);
            console.log("Fee====>", microLamports, gasFee, cu);
            console.log("Is_BUY", is_buy);
            const instructions = is_buy
                ? [
                    web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: microLamports,
                    }),
                    web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
                    // JitoTipOption
                    web3_js_1.SystemProgram.transfer({
                        fromPubkey: wallet.publicKey,
                        toPubkey: wallet.publicKey,
                        lamports: jitoFeeValueWei,
                    }),
                    (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(wallet.publicKey, tokenAccountIn, wallet.publicKey, spl_token_1.NATIVE_MINT),
                    web3_js_1.SystemProgram.transfer({
                        fromPubkey: wallet.publicKey,
                        toPubkey: tokenAccountIn,
                        lamports: amount,
                    }),
                    (0, spl_token_1.createSyncNativeInstruction)(tokenAccountIn, raydium_sdk_1.TOKEN_PROGRAM_ID),
                    (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(wallet.publicKey, tokenAccountOut, wallet.publicKey, new web3_js_1.PublicKey(mint)),
                    ...raydiumSwapInnerInstruction.instructions,
                    // Unwrap WSOL for SOL
                    (0, spl_token_1.createCloseAccountInstruction)(tokenAccountIn, wallet.publicKey, wallet.publicKey),
                ]
                : [
                    web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: microLamports,
                    }),
                    web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
                    // JitoTipOption
                    web3_js_1.SystemProgram.transfer({
                        fromPubkey: wallet.publicKey,
                        toPubkey: wallet.publicKey,
                        lamports: jitoFeeValueWei,
                    }),
                    (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(wallet.publicKey, tokenAccountOut, wallet.publicKey, spl_token_1.NATIVE_MINT),
                    ...raydiumSwapInnerInstruction.instructions,
                    // Unwrap WSOL for SOL
                    (0, spl_token_1.createCloseAccountInstruction)(tokenAccountOut, wallet.publicKey, wallet.publicKey),
                ];
            console.log("🚀 Quote ~", quoteAmount, total_fee_in_sol, total_fee_in_token);
            // Route all fees to BOT_WALLET_ADDRESS (no external referral split)
            console.log("Before Fee routing: ", Date.now());
            const botWalletAddr = process.env.BOT_WALLET_ADDRESS;
            if (!botWalletAddr)
                console.warn('BOT_WALLET_ADDRESS not set; fees will not be routed to bot.');
            const totalSolFees = Number(total_fee_in_sol || 0);
            if (totalSolFees > 0 && botWalletAddr) {
                instructions.push(web3_js_1.SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: new web3_js_1.PublicKey(botWalletAddr),
                    lamports: totalSolFees,
                }));
            }
            // Route token fees to bot ATA
            if (total_fee_in_token && total_fee_in_token > 0 && botWalletAddr) {
                try {
                    const mintPubkey = new web3_js_1.PublicKey(is_buy ? outputMint : inputMint);
                    const botPub = new web3_js_1.PublicKey(botWalletAddr);
                    const botAta = (0, spl_token_1.getAssociatedTokenAddressSync)(mintPubkey, botPub, true);
                    const ownerAta = (0, spl_token_1.getAssociatedTokenAddressSync)(mintPubkey, wallet.publicKey, true);
                    instructions.push((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(wallet.publicKey, botAta, botPub, mintPubkey));
                    instructions.push((0, spl_token_1.createTransferInstruction)(ownerAta, botAta, wallet.publicKey, Number(total_fee_in_token), [], raydium_sdk_1.TOKEN_PROGRAM_ID));
                }
                catch (e) {
                    console.warn('Failed to route token fees to bot ATA in raydium swap:', e?.message || e);
                }
            }
            console.log("After Fee routing: ", Date.now());
            const { blockhash, lastValidBlockHeight } = await config_1.private_connection.getLatestBlockhash();
            const messageV0 = new web3_js_1.TransactionMessage({
                payerKey: wallet.publicKey,
                recentBlockhash: blockhash,
                instructions,
            }).compileToV0Message();
            const transaction = new web3_js_1.VersionedTransaction(messageV0);
            // transaction.sign([wallet]);
            transaction.sign([wallet, ...raydiumSwapInnerInstruction.signers]);
            // Sign the transaction
            const signature = (0, get_signature_1.getSignature)(transaction);
            // We first simulate whether the transaction would be successful
            const { value: simulatedTransactionResponse } = await config_1.private_connection.simulateTransaction(transaction, {
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
        }
        catch (e) {
            console.log("SwapToken Failed", e);
            return null;
        }
    }
}
exports.RaydiumSwapService = RaydiumSwapService;
async function getWalletTokenAccount(connection, wallet) {
    const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
        programId: raydium_sdk_1.TOKEN_PROGRAM_ID,
    });
    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: raydium_sdk_1.SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
}
const calculateMicroLamports = (gasvalue, cu) => {
    const microlamports = ((gasvalue - 0.000005) * (10 ** 15 / cu)).toFixed(0);
    return Number(microlamports);
};
exports.calculateMicroLamports = calculateMicroLamports;
const syncAmmPoolKeys = async (poolId) => {
    console.log("syncAmmPoolKeys");
    // const tokenInfo = await RaydiumTokenService.findLastOne({
    //   poolId: poolId
    // });
    // if (tokenInfo) {
    // if (tokenInfo.ammKeys) return tokenInfo.ammKeys;
    const poolKeys = await (0, formatAmmKeysById_1.formatAmmKeysById)(poolId);
    const filter = { poolId };
    const data = { ammKeys: poolKeys };
    await RaydiumTokenService.findOneAndUpdate({ filter, data });
    return poolKeys;
    // }
};
exports.syncAmmPoolKeys = syncAmmPoolKeys;
const syncClmmPoolKeys = async (poolId) => {
    console.log("syncClmmPoolKeys");
    // const tokenInfo = await RaydiumTokenService.findLastOne({
    //   poolId: poolId
    // });
    // if (tokenInfo) {
    //   if (tokenInfo.clmmKeys) return tokenInfo.clmmKeys;
    const poolKeys = await (0, formatClmmKeysById_1.formatClmmKeysById)(poolId);
    const filter = { poolId };
    const data = { clmmKeys: poolKeys };
    await RaydiumTokenService.findOneAndUpdate({ filter, data });
    return poolKeys;
    // }
};
exports.syncClmmPoolKeys = syncClmmPoolKeys;
