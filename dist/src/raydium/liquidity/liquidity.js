"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertDBForPoolStateV4 = exports.MINIMAL_MARKET_STATE_LAYOUT_V3 = exports.OPENBOOK_PROGRAM_ID = exports.RAYDIUM_LIQUIDITY_PROGRAM_ID_V4 = exports.RAYDIUM_LIQUIDITY_PROGRAM_ID_CLMM = void 0;
exports.createPoolKeys = createPoolKeys;
exports.getTokenAccounts = getTokenAccounts;
const web3_js_1 = require("@solana/web3.js");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const spl_token_1 = require("@solana/spl-token");
exports.RAYDIUM_LIQUIDITY_PROGRAM_ID_CLMM = raydium_sdk_1.MAINNET_PROGRAM_ID.CLMM;
exports.RAYDIUM_LIQUIDITY_PROGRAM_ID_V4 = raydium_sdk_1.MAINNET_PROGRAM_ID.AmmV4;
exports.OPENBOOK_PROGRAM_ID = raydium_sdk_1.MAINNET_PROGRAM_ID.OPENBOOK_MARKET;
exports.MINIMAL_MARKET_STATE_LAYOUT_V3 = (0, raydium_sdk_1.struct)([
    (0, raydium_sdk_1.publicKey)("eventQueue"),
    (0, raydium_sdk_1.publicKey)("bids"),
    (0, raydium_sdk_1.publicKey)("asks"),
]);
function createPoolKeys(id, accountData, minimalMarketLayoutV3) {
    return {
        id,
        baseMint: accountData.baseMint,
        quoteMint: accountData.quoteMint,
        lpMint: accountData.lpMint,
        baseDecimals: Number(accountData.baseDecimal), // .toNumber(),
        quoteDecimals: Number(accountData.quoteDecimal), // .toNumber(),
        lpDecimals: 5,
        version: 4,
        programId: exports.RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
        authority: raydium_sdk_1.Liquidity.getAssociatedAuthority({
            programId: exports.RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
        }).publicKey,
        openOrders: accountData.openOrders,
        targetOrders: accountData.targetOrders,
        baseVault: accountData.baseVault,
        quoteVault: accountData.quoteVault,
        marketVersion: 3,
        marketProgramId: accountData.marketProgramId,
        marketId: accountData.marketId,
        marketAuthority: raydium_sdk_1.Market.getAssociatedAuthority({
            programId: accountData.marketProgramId,
            marketId: accountData.marketId,
        }).publicKey,
        marketBaseVault: accountData.baseVault,
        marketQuoteVault: accountData.quoteVault,
        marketBids: minimalMarketLayoutV3.bids,
        marketAsks: minimalMarketLayoutV3.asks,
        marketEventQueue: minimalMarketLayoutV3.eventQueue,
        withdrawQueue: accountData.withdrawQueue,
        lpVault: accountData.lpVault,
        lookupTableAccount: web3_js_1.PublicKey.default,
    };
}
async function getTokenAccounts(connection, owner, commitment) {
    const tokenResp = await connection.getTokenAccountsByOwner(owner, {
        programId: spl_token_1.TOKEN_PROGRAM_ID,
    }, commitment);
    const accounts = [];
    for (const { pubkey, account } of tokenResp.value) {
        accounts.push({
            pubkey,
            programId: account.owner,
            accountInfo: raydium_sdk_1.SPL_ACCOUNT_LAYOUT.decode(account.data),
        });
    }
    return accounts;
}
const convertDBForPoolStateV4 = (poolstate) => {
    return {
        status: poolstate.status,
        nonce: poolstate.nonce,
        maxOrder: poolstate.maxOrder,
        depth: poolstate.depth,
        baseDecimal: poolstate.baseDecimal,
        quoteDecimal: poolstate.quoteDecimal,
        state: poolstate.state,
        resetFlag: poolstate.resetFlag,
        minSize: poolstate.minSize,
        volMaxCutRatio: poolstate.volMaxCutRatio,
        amountWaveRatio: poolstate.amountWaveRatio,
        baseLotSize: poolstate.baseLotSize,
        quoteLotSize: poolstate.quoteLotSize,
        minPriceMultiplier: poolstate.minPriceMultiplier,
        maxPriceMultiplier: poolstate.maxPriceMultiplier,
        systemDecimalValue: poolstate.systemDecimalValue,
        minSeparateNumerator: poolstate.minSeparateNumerator,
        minSeparateDenominator: poolstate.minSeparateDenominator,
        tradeFeeNumerator: poolstate.tradeFeeNumerator,
        tradeFeeDenominator: poolstate.tradeFeeDenominator,
        pnlNumerator: poolstate.pnlNumerator,
        pnlDenominator: poolstate.pnlDenominator,
        swapFeeNumerator: poolstate.swapFeeNumerator,
        swapFeeDenominator: poolstate.swapFeeDenominator,
        baseNeedTakePnl: poolstate.baseNeedTakePnl,
        quoteNeedTakePnl: poolstate.quoteNeedTakePnl,
        quoteTotalPnl: poolstate.quoteTotalPnl,
        baseTotalPnl: poolstate.baseTotalPnl,
        poolOpenTime: poolstate.poolOpenTime,
        punishPcAmount: poolstate.punishPcAmount,
        punishCoinAmount: poolstate.punishCoinAmount,
        orderbookToInitTime: poolstate.orderbookToInitTime,
        swapBaseInAmount: poolstate.swapBaseInAmount,
        swapQuoteOutAmount: poolstate.swapQuoteOutAmount,
        swapBase2QuoteFee: poolstate.swapBase2QuoteFee,
        swapQuoteInAmount: poolstate.swapQuoteInAmount,
        swapBaseOutAmount: poolstate.swapBaseOutAmount,
        swapQuote2BaseFee: poolstate.swapQuote2BaseFee,
        baseVault: new web3_js_1.PublicKey(poolstate.baseVault),
        quoteVault: new web3_js_1.PublicKey(poolstate.quoteVault),
        baseMint: new web3_js_1.PublicKey(poolstate.baseMint),
        quoteMint: new web3_js_1.PublicKey(poolstate.quoteMint),
        lpMint: new web3_js_1.PublicKey(poolstate.lpMint),
        openOrders: new web3_js_1.PublicKey(poolstate.openOrders),
        marketId: new web3_js_1.PublicKey(poolstate.marketId),
        marketProgramId: new web3_js_1.PublicKey(poolstate.marketProgramId),
        targetOrders: new web3_js_1.PublicKey(poolstate.targetOrders),
        withdrawQueue: new web3_js_1.PublicKey(poolstate.withdrawQueue),
        lpVault: new web3_js_1.PublicKey(poolstate.lpVault),
        owner: new web3_js_1.PublicKey(poolstate.owner),
        lpReserve: poolstate.lpReserve,
    };
};
exports.convertDBForPoolStateV4 = convertDBForPoolStateV4;
