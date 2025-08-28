"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteDelayMessage = exports.sendUsernameRequiredNotification = exports.sendInsufficientNotification = exports.sendNoneExistTokenNotification = exports.sendNoneUserNotification = exports.closeInlinekeyboardOpts = exports.closeReplyMarkup = void 0;
let TelegramBot;
let SendMessageOptions;
try {
    const _tg = require('node-telegram-bot-api');
    TelegramBot = _tg.default || _tg;
    SendMessageOptions = _tg.SendMessageOptions || undefined;
}
catch (e) { }
exports.closeReplyMarkup = {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
        inline_keyboard: [
            [
                {
                    text: "❌ Close",
                    callback_data: JSON.stringify({
                        command: "dismiss_message",
                    }),
                },
            ],
        ],
    },
};
exports.closeInlinekeyboardOpts = {
    text: "❌ Close",
    callback_data: JSON.stringify({
        command: "dismiss_message",
    }),
};
const sendNoneUserNotification = async (bot, msg) => {
    const { id: chat_id } = msg.chat;
    const sentMsg = await bot.sendMessage(chat_id, "⚠︎ Error\n<b>This account does not exist. Please contact support team.</b>", exports.closeReplyMarkup);
    (0, exports.deleteDelayMessage)(bot, chat_id, sentMsg.message_id, 5000);
};
exports.sendNoneUserNotification = sendNoneUserNotification;
const sendNoneExistTokenNotification = async (bot, msg) => {
    const { id: chat_id } = msg.chat;
    const sentMsg = await bot.sendMessage(chat_id, "⚠︎ Error\n<b>This token does not exist. Please verify the mint address again or try later.</b>", {
        parse_mode: "HTML",
    });
    (0, exports.deleteDelayMessage)(bot, chat_id, sentMsg.message_id, 5000);
};
exports.sendNoneExistTokenNotification = sendNoneExistTokenNotification;
const sendInsufficientNotification = async (bot, msg) => {
    const { id: chat_id } = msg.chat;
    const sentMsg = await bot.sendMessage(chat_id, "⚠︎ Error\n<b>Insufficient amount.</b>", {
        parse_mode: "HTML",
    });
    (0, exports.deleteDelayMessage)(bot, chat_id, sentMsg.message_id, 5000);
};
exports.sendInsufficientNotification = sendInsufficientNotification;
const sendUsernameRequiredNotification = async (bot, msg) => {
    const { id: chat_id } = msg.chat;
    const sentMsg = await bot.sendMessage(chat_id, "⚠︎ Error\n<b>You have no telegram username yourself. Please edit your profile and try it again.</b>", exports.closeReplyMarkup);
};
exports.sendUsernameRequiredNotification = sendUsernameRequiredNotification;
// delay: ms
const deleteDelayMessage = (bot, chat_id, message_id, delay) => {
    try {
        setTimeout(() => {
            bot.deleteMessage(chat_id, message_id);
        }, delay);
    }
    catch (e) { }
};
exports.deleteDelayMessage = deleteDelayMessage;
