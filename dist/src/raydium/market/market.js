"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertDBForMarketV3 = void 0;
exports.getMinimalMarketV3 = getMinimalMarketV3;
const web3_js_1 = require("@solana/web3.js");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const liquidity_1 = require("../liquidity");
async function getMinimalMarketV3(connection, marketId, commitment) {
    const marketInfo = await connection.getAccountInfo(marketId, {
        commitment,
        dataSlice: {
            offset: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.offsetOf("eventQueue"),
            length: 32 * 3,
        },
    });
    return liquidity_1.MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo.data);
}
const convertDBForMarketV3 = (market) => {
    return {
        eventQueue: new web3_js_1.PublicKey(market.eventQueue),
        bids: new web3_js_1.PublicKey(market.bids),
        asks: new web3_js_1.PublicKey(market.asks),
    };
};
exports.convertDBForMarketV3 = convertDBForMarketV3;
