"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatClmmKeysById = formatClmmKeysById;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("../../config");
const formatClmmConfigs_1 = require("./formatClmmConfigs");
const formatClmmKeys_1 = require("./formatClmmKeys");
async function getMintProgram(mint) {
    const account = await config_1.private_connection.getAccountInfo(mint);
    if (account === null)
        throw Error(" get id info error ");
    return account.owner;
}
async function getConfigInfo(configId) {
    const account = await config_1.private_connection.getAccountInfo(configId);
    if (account === null)
        throw Error(" get id info error ");
    return (0, formatClmmConfigs_1.formatConfigInfo)(configId, account);
}
async function formatClmmKeysById(id) {
    const account = await config_1.private_connection.getAccountInfo(new web3_js_1.PublicKey(id));
    if (account === null)
        throw Error(" get id info error ");
    const info = raydium_sdk_1.PoolInfoLayout.decode(account.data);
    return {
        id,
        mintProgramIdA: (await getMintProgram(info.mintA)).toString(),
        mintProgramIdB: (await getMintProgram(info.mintB)).toString(),
        mintA: info.mintA.toString(),
        mintB: info.mintB.toString(),
        vaultA: info.vaultA.toString(),
        vaultB: info.vaultB.toString(),
        mintDecimalsA: info.mintDecimalsA,
        mintDecimalsB: info.mintDecimalsB,
        ammConfig: await getConfigInfo(info.ammConfig),
        rewardInfos: await Promise.all(info.rewardInfos
            .filter((i) => !i.tokenMint.equals(web3_js_1.PublicKey.default))
            .map(async (i) => ({
            mint: i.tokenMint.toString(),
            programId: (await getMintProgram(i.tokenMint)).toString(),
        }))),
        tvl: 0,
        day: (0, formatClmmKeys_1.getApiClmmPoolsItemStatisticsDefault)(),
        week: (0, formatClmmKeys_1.getApiClmmPoolsItemStatisticsDefault)(),
        month: (0, formatClmmKeys_1.getApiClmmPoolsItemStatisticsDefault)(),
        lookupTableAccount: web3_js_1.PublicKey.default.toString(),
    };
}
