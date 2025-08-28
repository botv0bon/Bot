"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshPayoutHandler = exports.backToReferralHomeScreenHandler = exports.setSOLPayoutAddressHandler = exports.sendPayoutAddressManageScreen = void 0;
let TelegramBot;
try {
    const _tg = require('node-telegram-bot-api');
    TelegramBot = _tg.default || _tg;
}
catch (e) { }
const utils_1 = require("../utils");
let INPUT_SOL_ADDRESS;
try {
    INPUT_SOL_ADDRESS = require('../bot.opts').INPUT_SOL_ADDRESS;
}
catch (e) {
    INPUT_SOL_ADDRESS = "";
}
const utils_2 = require("../utils");
const referral_link_handler_1 = require("./referral.link.handler");
const UserService = (() => {
    try {
        return require("../services/user.service").UserService;
    }
    catch (e) {
        return null;
    }
})();
const sendPayoutAddressManageScreen = async (bot, chat, message_id) => {
    try {
        if (!chat.username)
            return;
        // fetch payout address list
        // const refdata = await get_referral_info(chat.username);
        // if (!refdata) {
        //     bot.sendMessage(chat.id, 'You have no referral code. Please create a referral code first.');
        //     return;
        // }
        // const { busdpayout, solpayout, uniquecode } = refdata;
        // const profitdata = await get_profits(uniquecode);
        const userInfo = await UserService.findOne({ username: chat.username });
        const payout_wallet = userInfo?.referrer_wallet ?? "";
        // `<b>Your profits</b> 💰\n` +
        //     // `Total profits: $${profitdata?.total_profit.toFixed(3) ?? "0"}\n` +
        //     // `Available profits: $${profitdata?.available_profit.toFixed(3) ?? "0"}` +
        //     `\n\n` +
        const caption = "<b>Payout address</b>👇\n" +
            `<b>SOL</b> wallet (Solana) 🔹\n${(0, utils_1.copytoclipboard)(payout_wallet)}`;
        // \n\n` +
        // `<b>Current referral percentage: First Month: 25%</b>`
        // `<b>USDT</b> wallet (BNB-chain) 🔸\n${copytoclipboard(busdpayout)}\n\n` +
        // `Note: Payouts can be requests when profits reach a value of 20$.`
        const reply_markup = {
            inline_keyboard: [
                [
                    {
                        text: "Update SOL address",
                        callback_data: JSON.stringify({
                            command: "set_sol_address",
                        }),
                    },
                ],
                // [{
                //     text: 'Payout history',
                //     callback_data: JSON.stringify({
                //         'command': 'get_payout_history'
                //     })
                // }],
                [
                    {
                        text: "Refresh",
                        callback_data: JSON.stringify({
                            command: "refresh_payout",
                        }),
                    },
                    {
                        text: "Back",
                        callback_data: JSON.stringify({
                            command: "back_from_ref",
                        }),
                    },
                ],
            ],
        };
        await bot.editMessageCaption(caption, {
            chat_id: chat.id,
            message_id,
            parse_mode: "HTML",
            reply_markup,
        });
    }
    catch (e) {
        console.log("sendPayoutAddressManageScreen Error", e);
    }
};
exports.sendPayoutAddressManageScreen = sendPayoutAddressManageScreen;
const setSOLPayoutAddressHandler = async (bot, chat) => {
    try {
        if (!chat.username)
            return;
        const solAddressMsg = await bot.sendMessage(chat.id, INPUT_SOL_ADDRESS, {
            parse_mode: "HTML",
        });
        const textEventHandler = async (msg) => {
            const receivedChatId = msg.chat.id;
            const receivedText = msg.text;
            const receivedMessageId = msg.message_id;
            const receivedTextSender = msg.chat.username;
            // Check if the received message ID matches the original message ID
            if (receivedText &&
                receivedChatId === chat.id &&
                receivedMessageId === solAddressMsg.message_id + 1) {
                // message should be same user
                if (receivedTextSender === chat.username) {
                    // update address
                    updateSOLaddressForPayout(bot, chat, solAddressMsg.message_id, receivedText);
                }
                bot.removeListener("text", textEventHandler);
            }
        };
        // Add the 'text' event listener
        bot.on("text", textEventHandler);
    }
    catch (e) {
        console.log("setSOLPayoutAddressHandler", e);
    }
};
exports.setSOLPayoutAddressHandler = setSOLPayoutAddressHandler;
const updateSOLaddressForPayout = async (bot, chat, old_message_id, address) => {
    try {
        const chatId = chat.id;
        // validate first
        if (!(0, utils_2.isValidWalletAddress)(address)) {
            bot.deleteMessage(chatId, old_message_id);
            const message = await bot.sendMessage(chatId, "Invalid wallet address. Try it again");
            setTimeout(() => {
                bot.deleteMessage(chatId, message.message_id);
            }, 3000);
            (0, exports.setSOLPayoutAddressHandler)(bot, chat);
            return;
        }
        const username = chat.username;
        if (!username)
            return;
        // post
        const res = await UserService.updateMany({ username: username }, {
            referrer_wallet: address,
        });
        // const res = await update_payout_address(
        //     username,
        //     undefined,
        //     address,
        // )
        if (true) {
            const sentMsg = await bot.sendMessage(chatId, "Successfully updated!");
            setTimeout(() => {
                bot.deleteMessage(chatId, sentMsg.message_id);
                bot.deleteMessage(chatId, old_message_id + 1);
                bot.deleteMessage(chatId, old_message_id);
            }, 2000);
        }
    }
    catch (e) {
        console.log("updateSOLaddressForPayout", e);
    }
};
const backToReferralHomeScreenHandler = async (bot, chat, msg) => {
    if (!chat.username)
        return;
    bot.deleteMessage(chat.id, msg.message_id);
    (0, referral_link_handler_1.OpenReferralWindowHandler)(bot, msg);
};
exports.backToReferralHomeScreenHandler = backToReferralHomeScreenHandler;
const refreshPayoutHandler = async (bot, msg) => {
    const chat = msg.chat;
    if (!chat.username)
        return;
    await (0, exports.sendPayoutAddressManageScreen)(bot, chat, msg.message_id);
};
exports.refreshPayoutHandler = refreshPayoutHandler;
