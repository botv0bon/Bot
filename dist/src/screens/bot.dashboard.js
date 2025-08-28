"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchedule = exports.sendMsgForAlertScheduleHandler = exports.openAlertBotDashboard = void 0;
let TelegramBot;
try {
    const _tg = require('node-telegram-bot-api');
    TelegramBot = _tg.default || _tg;
}
catch (e) { }
let AlertBotID;
let WELCOME_REFERRAL;
try {
    const _b = require('../bot.opts');
    AlertBotID = _b.AlertBotID;
    WELCOME_REFERRAL = _b.WELCOME_REFERRAL;
}
catch (e) {
    AlertBotID = WELCOME_REFERRAL = null;
}
let get_referrer_info;
try {
    get_referrer_info = require("../services/referral.service").get_referrer_info;
}
catch (e) {
    get_referrer_info = null;
}
let ReferralChannelController;
try {
    ReferralChannelController = require("../controllers/referral.channel").ReferralChannelController;
}
catch (e) {
    ReferralChannelController = null;
}
let UserService;
try {
    UserService = require("../services/user.service").UserService;
}
catch (e) {
    UserService = null;
}
let ReferralChannelService;
let ReferralPlatform;
try {
    const _r = require("../services/referral.channel.service");
    ReferralChannelService = _r.ReferralChannelService;
    ReferralPlatform = _r.ReferralPlatform;
}
catch (e) {
    ReferralChannelService = null;
    ReferralPlatform = null;
}
const openAlertBotDashboard = async (bot, chat) => {
    try {
        const chatId = chat.id;
        const username = chat.username;
        if (!username)
            return;
        const refdata = await get_referrer_info(username);
        if (!refdata) {
            bot.sendMessage(chat.id, "You have no referral code. Please create a referral code first.");
            return;
        }
        const { schedule, uniquecode } = refdata;
        const channels = await ReferralChannelController.find({
            referral_code: uniquecode,
        });
        const inlineKeyboards = [
            [
                {
                    text: "Alert Schedule 🕓",
                    callback_data: JSON.stringify({
                        command: "alert_schedule",
                    }),
                },
                {
                    text: "Invite AlertBot 🤖",
                    // callback_data: JSON.stringify({
                    //   'command': 'dummy_button'
                    // })
                    url: `https://t.me/${AlertBotID}?startgroup=tradebot`,
                },
            ],
            [
                {
                    text: "Refresh bot info",
                    callback_data: JSON.stringify({
                        command: "refresh_alert_bot",
                    }),
                },
                {
                    text: "Back",
                    callback_data: JSON.stringify({
                        command: "back_from_ref",
                    }),
                },
            ],
        ];
        const reply_markup = {
            inline_keyboard: inlineKeyboards,
        };
        let channelList = ``;
        for (const channel of channels) {
            const { channel_name } = channel;
            channelList += `🟢 ${channel_name}\n`;
        }
        if (channels.length <= 0) {
            channelList +=
                "You have not invited our alert bot into any channel yet.\n";
        }
        const contents = `<b>AlertBot Configuration</b>\n\n` +
            `<b>Channels</b>\n` +
            `${channelList}\n` +
            "<b>Alert schedule</b>\n" +
            `Bot will send alerts every <b>${schedule ?? 30}</b> minutes.\n\n` +
            `Once you setup at least one group, you can then invite @${AlertBotID} into your group-chat.\n\n` +
            `If you want to update the settings, you can do it through the menu down below 👇🏼`;
        await bot.sendPhoto(chatId, WELCOME_REFERRAL, {
            caption: contents,
            reply_markup,
            parse_mode: "HTML",
        });
    }
    catch (e) {
        console.log("~ openAlertBotDashboard Error ~", e);
    }
};
exports.openAlertBotDashboard = openAlertBotDashboard;
const sendMsgForAlertScheduleHandler = async (bot, chat) => {
    try {
        if (!chat.username)
            return;
        const msgText = `Please, set a time alert frequency 👇🏼.`;
        const inlineKeyboards = [
            [
                {
                    text: "10mins",
                    callback_data: JSON.stringify({
                        command: "schedule_time_10",
                    }),
                },
                {
                    text: "30mins",
                    callback_data: JSON.stringify({
                        command: "schedule_time_30",
                    }),
                },
            ],
            [
                {
                    text: "1h",
                    callback_data: JSON.stringify({
                        command: "schedule_time_60",
                    }),
                },
                {
                    text: "3h",
                    callback_data: JSON.stringify({
                        command: "schedule_time_180",
                    }),
                },
                {
                    text: "4h",
                    callback_data: JSON.stringify({
                        command: "schedule_time_240",
                    }),
                },
                {
                    text: "6h",
                    callback_data: JSON.stringify({
                        command: "schedule_time_360",
                    }),
                },
            ],
        ];
        const reply_markup = {
            inline_keyboard: inlineKeyboards,
        };
        await bot.sendMessage(chat.id, msgText, {
            reply_markup,
            parse_mode: "HTML",
        });
    }
    catch (e) {
        console.log("sendMsgForChannelIDHandler", e);
    }
};
exports.sendMsgForAlertScheduleHandler = sendMsgForAlertScheduleHandler;
const updateSchedule = async (bot, chat, scheduleTime) => {
    try {
        const chatId = chat.id;
        const username = chat.username;
        if (!username)
            return;
        // update channel DB as well
        const referralChannelService = new ReferralChannelService();
        const result = await referralChannelService.updateReferralChannel({
            creator: username,
            platform: ReferralPlatform.TradeBot,
            schedule: scheduleTime,
        });
        console.log(result);
        if (!result)
            return;
        // post
        const res = await UserService.updateMany({ username: username }, { schedule: scheduleTime });
        if (res) {
            bot.sendMessage(chatId, "Successfully updated!");
        }
        else {
            bot.sendMessage(chatId, "Update schedule failed! Try it again");
        }
    }
    catch (e) {
        console.log("updateSchedule", e);
    }
};
exports.updateSchedule = updateSchedule;
