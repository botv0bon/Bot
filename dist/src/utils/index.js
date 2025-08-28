"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromWeiToValue = exports.isEqual = exports.copytoclipboard = exports.getPrice = exports.dexscreenerLink = exports.dextoolLink = exports.birdeyeLink = exports.contractLink = exports.generateReferralCode = void 0;
exports.isValidWalletAddress = isValidWalletAddress;
exports.formatNumber = formatNumber;
exports.formatKMB = formatKMB;
exports.formatPrice = formatPrice;
const config_1 = require("../config");
// import redisClient from "../services/redis";
function isValidWalletAddress(address) {
    if (!address)
        return false;
    const pattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return pattern.test(address);
}
const generateReferralCode = (length) => {
    let code = '';
    // Convert the Telegram username to a hexadecimal string
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
};
exports.generateReferralCode = generateReferralCode;
function formatNumber(number) {
    if (!number)
        return "0";
    // Convert the number to a string and add commas using regular expression
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function formatKMB(val) {
    if (!val)
        return "0";
    if (Number(val) > 1000000000) {
        return `${(Number(val) / 1000000000).toFixed(1)}B`;
    }
    if (Number(val) > 1000000) {
        return `${(Number(val) / 1000000).toFixed(1)}M`;
    }
    if (Number(val) > 1000) {
        return `${(Number(val) / 1000).toFixed(1)}k`;
    }
    return Number(val).toFixed(3);
}
const contractLink = (mint) => {
    return `<a href="https://solscan.io/token/${mint}">Contract</a>`;
};
exports.contractLink = contractLink;
const birdeyeLink = (mint) => {
    return `<a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>`;
};
exports.birdeyeLink = birdeyeLink;
const dextoolLink = (mint) => {
    return `<a href="https://www.dextools.io/app/en/solana/pair-explorer/${mint}">Dextools</a>`;
};
exports.dextoolLink = dextoolLink;
const dexscreenerLink = (mint) => {
    return `<a href="https://dexscreener.com/solana/${mint}">Dexscreener</a>`;
};
exports.dexscreenerLink = dexscreenerLink;
function formatPrice(price) {
    if (!price)
        return 0;
    if (price <= 0)
        return 0;
    // If the price is less than 1, format it to 6 decimal places
    if (price < 1) {
        let decimal = 15;
        while (1) {
            if (price * 10 ** decimal < 1) {
                break;
            }
            decimal--;
        }
        return price.toFixed(decimal + 3);
    }
    // If the price is greater than or equal to 1, format it to 3 decimal places
    return price.toFixed(2);
}
const getPrice = async (mint) => {
    const options = { method: 'GET', headers: config_1.REQUEST_HEADER };
    try {
        const res = await fetch(`https://public-api.birdeye.so/defi/price?address=${mint}`, options);
        const responseJson = await res.json();
        const price = responseJson?.data?.value;
        return typeof price === 'number' ? price : Number(price) || 0;
    }
    catch (err) {
        console.error('getPrice error:', err);
        return 0;
    }
};
exports.getPrice = getPrice;
const copytoclipboard = (text) => {
    return `<code class="text-entity-code clickable" role="textbox" tabindex="0" data-entity-type="MessageEntityCode">${text}</code>`;
};
exports.copytoclipboard = copytoclipboard;
const isEqual = (a, b) => {
    return Math.abs(b - a) < 0.001;
};
exports.isEqual = isEqual;
const fromWeiToValue = (wei, decimal) => {
    return Number(wei) / 10 ** decimal;
};
exports.fromWeiToValue = fromWeiToValue;
