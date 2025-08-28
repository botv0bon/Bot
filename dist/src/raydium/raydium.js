"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runListener = void 0;
exports.saveTokenAccount = saveTokenAccount;
exports.checkMintable = checkMintable;
exports.getTop10HoldersPercent = getTop10HoldersPercent;
exports.processOpenBookMarket = processOpenBookMarket;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const spl_token_1 = require("@solana/spl-token");
const web3_js_1 = require("@solana/web3.js");
const liquidity_1 = require("./liquidity");
const types_1 = require("./types");
let connection;
let COMMITMENT_LEVEL;
let RPC_WEBSOCKET_ENDPOINT;
let PRIVATE_RPC_ENDPOINT;
let RAYDIUM_AMM_URL;
let private_connection;
let RAYDIUM_CLMM_URL;
try {
    const _c = require("../config");
    connection = _c.connection;
    COMMITMENT_LEVEL = _c.COMMITMENT_LEVEL;
    RPC_WEBSOCKET_ENDPOINT = _c.RPC_WEBSOCKET_ENDPOINT;
    PRIVATE_RPC_ENDPOINT = _c.PRIVATE_RPC_ENDPOINT;
    RAYDIUM_AMM_URL = _c.RAYDIUM_AMM_URL;
    private_connection = _c.private_connection;
    RAYDIUM_CLMM_URL = _c.RAYDIUM_CLMM_URL;
}
catch (e) {
    connection = COMMITMENT_LEVEL = RPC_WEBSOCKET_ENDPOINT = PRIVATE_RPC_ENDPOINT = RAYDIUM_AMM_URL = private_connection = RAYDIUM_CLMM_URL = null;
}
let OpenMarketService;
let TokenService;
let RaydiumTokenService;
let redisClient;
try {
    OpenMarketService = require("../services/openmarket.service").OpenMarketService;
}
catch (e) {
    OpenMarketService = null;
}
try {
    TokenService = require("../services/token.metadata").TokenService;
}
catch (e) {
    TokenService = null;
}
try {
    RaydiumTokenService = require("../services/raydium.token.service").RaydiumTokenService;
}
catch (e) {
    RaydiumTokenService = null;
}
try {
    const _r = require("../services/redis");
    redisClient = _r && (_r.default || _r);
}
catch (e) {
    redisClient = null;
}
const raydium_service_1 = require("./raydium.service");
const solanaConnection = new web3_js_1.Connection(PRIVATE_RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});
const existingLiquidityPools = new Set();
const existingOpenBookMarkets = new Set();
async function initDB() {
    initAMM();
    initCLMM();
}
async function initAMM() {
    console.log(" - AMM Pool data fetching is started...");
    const ammRes = await fetch(RAYDIUM_AMM_URL);
    const ammData = await ammRes.json();
    console.log(" - AMM Pool data is fetched successfully...");
    const batchSize = 100; // Adjust this value based on your requirements
    const batches = [];
    for (let i = 0; i < ammData.length; i += batchSize) {
        batches.push(ammData.slice(i, i + batchSize));
    }
    for (const batch of batches) {
        await Promise.all(batch.map(async (i) => {
            if (i.baseMint === spl_token_1.NATIVE_MINT.toString() ||
                i.quoteMint === spl_token_1.NATIVE_MINT.toString()) {
                if (Number(i.liquidity) > 0) {
                    const tokenMint = i.baseMint === spl_token_1.NATIVE_MINT.toString() ? i.quoteMint : i.baseMint;
                    // const tokenMetadata = await TokenService.fetchSimpleMetaData(tokenMint);
                    const data = {
                        // name: tokenMetadata.name,
                        // symbol: tokenMetadata.symbol,
                        mint: tokenMint,
                        isAmm: true,
                        poolId: i.ammId,
                        creation_ts: Date.now(),
                    };
                    await RaydiumTokenService.create(data);
                }
            }
        }));
    }
    console.log(" - AMM Pool data is saved to MongoDB successfully...");
}
async function initCLMM() {
    console.log(" - CLMM Pool data fetching is started...");
    const clmmRes = await fetch(RAYDIUM_CLMM_URL);
    const clmmData = await clmmRes.json();
    console.log(" - CLMM Pool data is fetched successfully...");
    const batchSize = 100; // Adjust this value based on your requirements
    const batches = [];
    for (let i = 0; i < clmmData.data.length; i += batchSize) {
        batches.push(clmmData.data.slice(i, i + batchSize));
    }
    for (const batch of batches) {
        await Promise.all(batch.map(async (i) => {
            if (i.mintA === spl_token_1.NATIVE_MINT.toString() ||
                i.mintB === spl_token_1.NATIVE_MINT.toString()) {
                if (Number(i.tvl) > 0) {
                    const tokenMint = i.mintA === spl_token_1.NATIVE_MINT.toString() ? i.mintB : i.mintA;
                    // const tokenMetadata = await TokenService.fetchSimpleMetaData(tokenMint);
                    const data = {
                        // name: tokenMetadata.name,
                        // symbol: tokenMetadata.symbol,
                        mint: tokenMint,
                        isAmm: false,
                        poolId: i.id,
                        creation_ts: Date.now(),
                    };
                    await RaydiumTokenService.create(data);
                }
            }
        }));
    }
    console.log(" - CLMM Pool data is saved to MongoDB successfully...");
}
async function saveTokenAccount(mint, accountData) {
    const key = `openmarket_${mint}`;
    const res = await redisClient.get(key);
    if (res === "added")
        return;
    // const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
    const tokenAccount = {
        mint: mint,
        market: {
            bids: accountData.bids,
            asks: accountData.asks,
            eventQueue: accountData.eventQueue,
        },
    };
    await redisClient.set(key, "added");
    await OpenMarketService.create(tokenAccount);
    return tokenAccount;
}
async function checkMintable(vault) {
    try {
        let { data } = (await solanaConnection.getAccountInfo(vault)) || {};
        if (!data) {
            return;
        }
        const deserialize = types_1.MintLayout.decode(new Uint8Array(data));
        return deserialize.mintAuthorityOption === 0;
    }
    catch (e) {
        console.debug(e);
        console.error({ mint: vault }, `Failed to check if mint is renounced`);
    }
}
async function getTop10HoldersPercent(connection, mint, supply
// excludeAddress: string
) {
    try {
        const accounts = await connection.getTokenLargestAccounts(new web3_js_1.PublicKey(mint));
        let sum = 0;
        let counter = 0;
        for (const account of accounts.value) {
            // if (account.address.toString() === excludeAddress) continue;
            if (!account.uiAmount)
                continue;
            if (counter >= 10)
                break;
            counter++;
            sum += account.uiAmount;
        }
        return sum / supply;
    }
    catch (e) {
        return 0;
    }
}
async function processOpenBookMarket(updatedAccountInfo) {
    let accountData;
    try {
        accountData = raydium_sdk_1.MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
        // to be competitive, we collect market data before buying the token...
        // if (existingTokenAccounts.has(accountData.baseMint.toString())) {
        //   return;
        // }
        saveTokenAccount(accountData.baseMint, accountData);
    }
    catch (e) {
        console.debug(e);
        console.error({ mint: accountData?.baseMint }, `Failed to process market`);
    }
}
const runListener = async () => {
    // initDB();
    const runTimestamp = Math.floor(new Date().getTime() / 1000);
    const ammSubscriptionId = solanaConnection.onLogs(liquidity_1.RAYDIUM_LIQUIDITY_PROGRAM_ID_V4, async ({ logs, err, signature }) => {
        if (err)
            return;
        if (logs && logs.some((log) => log.includes("initialize2"))) {
            // console.log(`https://solscan.io/tx/${signature}`)
            fetchRaydiumMints(signature, liquidity_1.RAYDIUM_LIQUIDITY_PROGRAM_ID_V4.toString(), true);
        }
    }, COMMITMENT_LEVEL);
    const clmmSubscriptionId = solanaConnection.onLogs(liquidity_1.RAYDIUM_LIQUIDITY_PROGRAM_ID_CLMM, async ({ logs, err, signature }) => {
        if (err)
            return;
        if (logs && logs.some((log) => log.includes("OpenPositionV2"))) {
            fetchRaydiumMints(signature, liquidity_1.RAYDIUM_LIQUIDITY_PROGRAM_ID_CLMM.toString(), false);
        }
    }, COMMITMENT_LEVEL);
    async function fetchRaydiumMints(txId, instructionName, isAmm) {
        try {
            const tx = await connection.getParsedTransaction(txId, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            //@ts-ignore
            const accounts = tx?.transaction.message.instructions.find((ix) => ix.programId.toString() === instructionName)?.accounts;
            if (!accounts) {
                console.log("No accounts found in the transaction.");
                return;
            }
            const poolIdIndex = isAmm ? 4 : 5;
            const tokenAIndex = isAmm ? 8 : 21;
            const tokenBIndex = isAmm ? 9 : 20;
            const poolId = accounts[poolIdIndex];
            const existing = existingLiquidityPools.has(poolId.toString());
            if ((tx?.blockTime && tx?.blockTime < runTimestamp) || existing)
                return;
            existingLiquidityPools.add(poolId.toString());
            const tokenAaccount = accounts[tokenAIndex].toString() === spl_token_1.NATIVE_MINT.toString()
                ? accounts[tokenBIndex]
                : accounts[tokenAIndex];
            const tokenBaccount = accounts[tokenBIndex].toString() === spl_token_1.NATIVE_MINT.toString()
                ? accounts[tokenBIndex]
                : accounts[tokenAIndex];
            if (tokenBaccount.toString() !== spl_token_1.NATIVE_MINT.toString())
                return;
            const key = `raydium_mint_${poolId.toString()}`;
            const res = await redisClient.get(key);
            if (res === "added")
                return;
            const displayData = {
                "TxID:": `https://solscan.io/tx/${txId}`,
                "PoolID:": poolId.toString(),
                "TokenA:": tokenAaccount.toString(),
                "TokenB:": tokenBaccount.toString(),
            };
            console.log(` - New ${isAmm ? "AMM" : "CLMM"} Found`);
            console.table(displayData);
            const tokenMetadata = await TokenService.fetchMetadataInfo(tokenAaccount);
            // const mintable = mintOption !== true;
            const data = {
                name: tokenMetadata.name,
                symbol: tokenMetadata.symbol,
                mint: tokenAaccount.toString(),
                isAmm,
                poolId,
                creation_ts: Date.now(),
            };
            await redisClient.set(key, "added");
            await RaydiumTokenService.create(data);
            if (isAmm) {
                await (0, raydium_service_1.syncAmmPoolKeys)(poolId.toString());
            }
            else {
                await (0, raydium_service_1.syncClmmPoolKeys)(poolId.toString());
            }
        }
        catch (e) {
            console.log("Error fetching transaction:", e);
            return;
        }
    }
    // const openBookSubscriptionId = solanaConnection.onProgramAccountChange(
    //   OPENBOOK_PROGRAM_ID,
    //   async (updatedAccountInfo) => {
    //     const key = updatedAccountInfo.accountId.toString();
    //     const existing = existingOpenBookMarkets.has(key);
    //     if (!existing) {
    //       existingOpenBookMarkets.add(key);
    //       const _ = processOpenBookMarket(updatedAccountInfo);
    //     }
    //   },
    //   COMMITMENT_LEVEL,
    //   [
    //     { dataSize: MARKET_STATE_LAYOUT_V3.span },
    //     {
    //       memcmp: {
    //         offset: MARKET_STATE_LAYOUT_V3.offsetOf("quoteMint"),
    //         bytes: NATIVE_MINT.toString(),
    //       },
    //     },
    //   ]
    // );
    console.info(`Listening for raydium AMM changes: ${ammSubscriptionId}`);
    console.info(`Listening for raydium CLMM changes: ${clmmSubscriptionId}`);
    // console.info(`Listening for open book changes: ${openBookSubscriptionId}`);
    // Here, we need to remove this mint from snipe List
    // in our database
    // ------>
};
exports.runListener = runListener;
// export const getPrice = async (shitTokenAddress: string) => {
//   const response = await fetch(
//     "https://api.raydium.io/v2/main/price"
//   );
//   const tokenPrices = await response.json();
//   const solprice = tokenPrices[shitTokenAddress];
//   // Buy rate
//   const estimateRate = await estimateSwapRate(1, shitTokenAddress, false);
//   if (!estimateRate) return 0;
//   const tokenprice = estimateRate / solprice;
//   return tokenprice;
// };
