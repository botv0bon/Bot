"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showWelcomeReferralProgramMessage = void 0;
let TelegramBot;
try {
    const _tg = require('node-telegram-bot-api');
    TelegramBot = _tg.default || _tg;
}
catch (e) { }
let TradeBotID;
let WELCOME_REFERRAL;
try {
    const _b = require('../bot.opts');
    TradeBotID = _b.TradeBotID;
    WELCOME_REFERRAL = _b.WELCOME_REFERRAL;
}
catch (e) {
    TradeBotID = WELCOME_REFERRAL = null;
}
const utils_1 = require("../utils");
let get_referral_amount;
let get_referral_num;
try {
    const _r = require("../services/referral.service");
    get_referral_amount = _r.get_referral_amount;
    get_referral_num = _r.get_referral_num;
}
catch (e) {
    get_referral_amount = null;
    get_referral_num = null;
}
const showWelcomeReferralProgramMessage = async (bot, chat, uniquecode) => {
    try {
        const chatId = chat.id;
        const inlineKeyboards = [
            [
                {
                    text: "Manage payout 📄",
                    callback_data: JSON.stringify({
                        command: "payout_address",
                    }),
                },
            ],
            [
                {
                    text: "Set up Alert Bot 🤖",
                    callback_data: JSON.stringify({
                        command: "alert_bot",
                    }),
                },
                {
                    text: `❌ Close`,
                    callback_data: JSON.stringify({
                        command: "dismiss_message",
                    }),
                },
            ],
        ];
        if (!uniquecode || uniquecode === "") {
            const reply_markup = {
                inline_keyboard: [
                    [
                        {
                            text: "Create a referral code 💰",
                            callback_data: JSON.stringify({
                                command: "create_referral_code",
                            }),
                        },
                    ],
                    ...inlineKeyboards,
                ],
            };
            const caption = `<b>🎉 Welcome to the referral program</b>\n\n` +
                `Please create a unique referral code to get started👇.`;
            await bot.sendPhoto(chatId, WELCOME_REFERRAL, {
                caption: caption,
                reply_markup,
                parse_mode: "HTML",
            });
        }
        else {
            const reply_markup = {
                inline_keyboard: inlineKeyboards,
            };
            let num = await get_referral_num(uniquecode);
            let totalAmount = await get_referral_amount(uniquecode);
            const referralLink = `https://t.me/${TradeBotID}?start=${uniquecode}`;
            const contents = "<b>🎉 Welcome to referral program</b>\n\n" +
                `<b>Refer your friends and earn 25% of their fees in the first 45 days, 20% in the next 45 days and 15% forever!</b>\n\n` +
                `<b>Referred Count: ${num.num}\nSol Earned: ${totalAmount.totalAmount}</b>\n\n` +
                `<b>Your referral code 🔖</b>\n${(0, utils_1.copytoclipboard)(uniquecode)}\n\n` +
                `<b>Your referral link 🔗</b>\n${(0, utils_1.copytoclipboard)(referralLink)}\n\n` +
                // `<i>Note: Don't forget set up payout address to get paid</i>\n\n` +
                `- Share your referral link with whoever you want and earn from their swaps 🔁\n` +
                `- Check profits, payouts and change the payout address 📄\n`;
            await bot.sendPhoto(chatId, WELCOME_REFERRAL, {
                caption: contents,
                reply_markup,
                parse_mode: "HTML",
            });
        }
    }
    catch (e) {
        console.log("~ showWelcomeReferralProgramMessage Error ~", e);
    }
};
exports.showWelcomeReferralProgramMessage = showWelcomeReferralProgramMessage;
