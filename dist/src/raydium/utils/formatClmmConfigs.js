"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatConfigInfo = formatConfigInfo;
exports.formatClmmConfigs = formatClmmConfigs;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("../../config");
function formatConfigInfo(id, account) {
    const info = raydium_sdk_1.AmmConfigLayout.decode(account.data);
    return {
        id: id.toString(),
        index: info.index,
        protocolFeeRate: info.protocolFeeRate,
        tradeFeeRate: info.tradeFeeRate,
        tickSpacing: info.tickSpacing,
        fundFeeRate: info.fundFeeRate,
        fundOwner: info.fundOwner.toString(),
        description: "",
    };
}
async function formatClmmConfigs(programId) {
    const configAccountInfo = await config_1.private_connection.getProgramAccounts(new web3_js_1.PublicKey(programId), { filters: [{ dataSize: raydium_sdk_1.AmmConfigLayout.span }] });
    return configAccountInfo
        .map((i) => formatConfigInfo(i.pubkey, i.account))
        .reduce((a, b) => {
        a[b.id] = b;
        return a;
    }, {});
}
