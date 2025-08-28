"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateReferralCode = exports.OpenReferralWindowHandler = void 0;
let TelegramBot;
try {
    const _tg = require('node-telegram-bot-api');
    TelegramBot = _tg.default || _tg;
}
catch (e) { }
const welcome_referral_screen_1 = require("./welcome.referral.screen");
const utils_1 = require("../utils");
let UserService;
try {
    UserService = require("../services/user.service").UserService;
}
catch (e) {
    UserService = null;
}
let ReferralChannelService;
try {
    ReferralChannelService = require("../services/referral.channel.service").ReferralChannelService;
}
catch (e) {
    ReferralChannelService = null;
}
const OpenReferralWindowHandler = async (bot, msg) => {
    const chat = msg.chat;
    const username = chat.username;
    if (!username) {
        return;
    }
    // const data = await get_referral_info(username);
    // // if not created
    // if (!data) {
    //   showWelcomeReferralProgramMessage(bot, chat);
    //   return;
    // }
    // // if already created a link, we show link
    // const { uniquecode } = data;
    const referrerCode = await (0, exports.GenerateReferralCode)(username);
    (0, welcome_referral_screen_1.showWelcomeReferralProgramMessage)(bot, chat, referrerCode);
};
exports.OpenReferralWindowHandler = OpenReferralWindowHandler;
const GenerateReferralCode = async (username) => {
    const userInfo = await UserService.findOne({ username: username });
    if (!userInfo)
        return;
    const { referrer_code } = userInfo;
    let referrerCode = "";
    if (referrer_code && referrer_code !== "") {
        referrerCode = referrer_code;
    }
    else {
        let uniquecode = (0, utils_1.generateReferralCode)(10);
        referrerCode = uniquecode;
        const referralChannelService = new ReferralChannelService();
        const res = await referralChannelService.createReferralChannel(username, uniquecode);
        console.log(res);
        if (!res)
            return;
        await UserService.updateMany({ username: username }, { referrer_code: uniquecode });
    }
    return referrerCode;
};
exports.GenerateReferralCode = GenerateReferralCode;
