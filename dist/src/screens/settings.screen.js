"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pnlCardHandler = exports.setCustomJitoFeeHandler = exports.setCustomJitoFeeScreenHandler = exports.changeJitoTipFeeHandler = exports.getReplyOptionsForSettings = exports.switchAutoBuyOptsHandler = exports.switchBurnOptsHandler = exports.setCustomAutoBuyAmountHandler = exports.setCustomFeeHandler = exports.setCustomFeeScreenHandler = exports.changeGasFeeHandler = exports.setCustomBuyPresetHandler = exports.switchWalletHandler = exports.revealWalletPrivatekyHandler = exports.generateNewWalletHandler = exports.walletViewHandler = exports.presetBuyAmountScreenHandler = exports.autoBuyAmountScreenHandler = exports.presetBuyBtnHandler = exports.settingScreenHandler = void 0;
let TelegramBot;
try {
    const _tg = require('node-telegram-bot-api');
    TelegramBot = _tg.default || _tg;
}
catch (e) { }
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
const common_screen_1 = require("./common.screen");
const UserService = (() => {
    try {
        return require("../services/user.service").UserService;
    }
    catch (e) {
        return null;
    }
})();
const utils_1 = require("../utils");
let GrowTradeVersion;
let MAX_WALLET;
let private_connection;
try {
    const _c = require("../config");
    GrowTradeVersion = _c.GrowTradeVersion;
    MAX_WALLET = _c.MAX_WALLET;
    private_connection = _c.private_connection;
}
catch (e) {
    GrowTradeVersion = "";
    MAX_WALLET = null;
    private_connection = null;
}
const MsgLogService = (() => {
    try {
        return require("../services/msglog.service").MsgLogService;
    }
    catch (e) {
        return null;
    }
})();
let redisClient;
try {
    // redis export may be default or named
    const _r = require("../services/redis");
    redisClient = _r && (_r.default || _r);
}
catch (e) {
    redisClient = null;
}
let AUTO_BUY_TEXT;
let PRESET_BUY_TEXT;
let SET_GAS_FEE;
let SET_JITO_FEE;
let TradeBotID;
try {
    const _b = require("../bot.opts");
    AUTO_BUY_TEXT = _b.AUTO_BUY_TEXT;
    PRESET_BUY_TEXT = _b.PRESET_BUY_TEXT;
    SET_GAS_FEE = _b.SET_GAS_FEE;
    SET_JITO_FEE = _b.SET_JITO_FEE;
    TradeBotID = _b.TradeBotID;
}
catch (e) {
    AUTO_BUY_TEXT = PRESET_BUY_TEXT = SET_GAS_FEE = SET_JITO_FEE = TradeBotID = null;
}
const { GasFeeEnum, JitoFeeEnum, UserTradeSettingService, } = (() => {
    try {
        return require("../services/user.trade.setting.service");
    }
    catch (e) {
        return {};
    }
})();
const welcome_screen_1 = require("./welcome.screen");
const referral_link_handler_1 = require("./referral.link.handler");
const TokenService = (() => {
    try {
        return require("../services/token.metadata").TokenService;
    }
    catch (e) {
        return null;
    }
})();
const PNLService = (() => {
    try {
        return require("../services/pnl.service").PNLService;
    }
    catch (e) {
        return null;
    }
})();
const RaydiumTokenService = (() => {
    try {
        return require("../services/raydium.token.service").RaydiumTokenService;
    }
    catch (e) {
        return null;
    }
})();
const JupiterService = (() => {
    try {
        return require("../services/jupiter.service").JupiterService;
    }
    catch (e) {
        return null;
    }
})();
const spl_token_1 = require("@solana/spl-token");
let calcAmountOut;
try {
    calcAmountOut = require("../raydium/raydium.service").calcAmountOut;
}
catch (e) {
    calcAmountOut = null;
}
let getCoinData;
try {
    getCoinData = require("../pump/api").getCoinData;
}
catch (e) {
    getCoinData = null;
}
const settingScreenHandler = async (bot, msg, replaceId) => {
    try {
        const { chat } = msg;
        const { id: chat_id, username } = chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const user = await UserService.findOne({ username });
        if (!user) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const { wallet_address, auto_buy, auto_buy_amount } = user;
        const caption = `<b>GrowTrade ${GrowTradeVersion}</b>\n\n` +
            `<b>AutoBuy</b>\n` +
            `Automatically execute buys upon pasting token address. Customize the Sol amount and press the button to activate/deactivate.\n\n` +
            `<b>Withdraw</b>\n` +
            `Withdraw any token or Solana you have in the currently active wallet.\n\n` +
            `<b>Your active wallet:</b>\n` +
            `${(0, utils_1.copytoclipboard)(wallet_address)}`;
        const reply_markup = await (0, exports.getReplyOptionsForSettings)(username, auto_buy, auto_buy_amount);
        let sentMessageId = 0;
        if (replaceId) {
            bot.editMessageText(caption, {
                message_id: replaceId,
                chat_id,
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup,
            });
            sentMessageId = replaceId;
        }
        else {
            const sentMessage = await bot.sendMessage(chat_id, caption, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup,
            });
            sentMessageId = sentMessage.message_id;
        }
        await MsgLogService.create({
            username,
            mint: "slippage",
            wallet_address: wallet_address,
            chat_id,
            msg_id: sentMessageId,
            sol_amount: 0,
            spl_amount: 0,
            extra_key: 0,
        });
    }
    catch (e) {
        console.log("~ settingScreenHandler ~", e);
    }
};
exports.settingScreenHandler = settingScreenHandler;
const presetBuyBtnHandler = async (bot, msg) => {
    const { chat } = msg;
    const { id: chat_id, username, first_name, last_name } = chat;
    if (!username) {
        await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
        return;
    }
    const user = await UserService.findOne({ username });
    if (!user) {
        await (0, common_screen_1.sendNoneUserNotification)(bot, msg);
        return;
    }
    let preset_setting = user.preset_setting ?? [0.01, 1, 5, 10];
    // caption for preset buy buttons
    const caption = `⚙ Manual Buy Amount Presets\n\n` +
        `💡 <i>Click on the button that you would like to change the value of</i>`;
    const sentMessage = await bot.sendMessage(chat_id, caption, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: `Buy ${preset_setting[0]} SOL`,
                        callback_data: JSON.stringify({
                            command: `preset_buy_0`,
                        }),
                    },
                    {
                        text: `Buy ${preset_setting[1]} SOL`,
                        callback_data: JSON.stringify({
                            command: `preset_buy_1`,
                        }),
                    },
                ],
                [
                    {
                        text: `Buy ${preset_setting[2]} SOL`,
                        callback_data: JSON.stringify({
                            command: `preset_buy_2`,
                        }),
                    },
                    {
                        text: `Buy ${preset_setting[3]} SOL`,
                        callback_data: JSON.stringify({
                            command: `preset_buy_3`,
                        }),
                    },
                ],
                [
                    {
                        text: `❌ Dismiss message`,
                        callback_data: JSON.stringify({
                            command: "dismiss_message",
                        }),
                    },
                ],
            ],
        },
    });
};
exports.presetBuyBtnHandler = presetBuyBtnHandler;
const autoBuyAmountScreenHandler = async (bot, msg, replaceId) => {
    try {
        const chat_id = msg.chat.id;
        const username = msg.chat.username;
        if (!username)
            return;
        const user = await UserService.findOne({ username });
        if (!user)
            return;
        const key = "autobuy_amount" + username;
        await redisClient.set(key, replaceId);
        const sentMessage = await bot.sendMessage(chat_id, AUTO_BUY_TEXT, {
            parse_mode: "HTML",
            reply_markup: {
                force_reply: true,
            },
        });
    }
    catch (e) {
        console.log("~buyCustomAmountScreenHandler~", e);
    }
};
exports.autoBuyAmountScreenHandler = autoBuyAmountScreenHandler;
const presetBuyAmountScreenHandler = async (bot, msg, preset_index) => {
    try {
        const chat_id = msg.chat.id;
        const username = msg.chat.username;
        if (!username)
            return;
        const user = await UserService.findOne({ username });
        if (!user)
            return;
        let key = "preset_index" + username;
        await redisClient.set(key, preset_index);
        const sentMessage = await bot.sendMessage(chat_id, PRESET_BUY_TEXT, {
            parse_mode: "HTML",
            reply_markup: {
                force_reply: true,
            },
        });
    }
    catch (e) {
        console.log("~buyCustomAmountScreenHandler~", e);
    }
};
exports.presetBuyAmountScreenHandler = presetBuyAmountScreenHandler;
const walletViewHandler = async (bot, msg) => {
    try {
        const { chat, message_id } = msg;
        const { id: chat_id, username } = chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const users = await UserService.findAndSort({ username });
        const activeuser = users.filter((user) => user.retired === false)[0];
        const { wallet_address } = activeuser;
        const caption = `<b>GrowTrade ${GrowTradeVersion}</b>\n\n<b>Your active wallet:</b>\n` +
            `${(0, utils_1.copytoclipboard)(wallet_address)}`;
        // const sentMessage = await bot.sendMessage(
        // chat_id,
        // caption,
        // {
        await bot.editMessageText(caption, {
            chat_id,
            message_id,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    ...users.map((user) => {
                        const { nonce, wallet_address, retired } = user;
                        return [
                            {
                                text: `${retired ? "🔴" : "🟢"} ${wallet_address}`,
                                callback_data: JSON.stringify({
                                    command: `wallet_${nonce}`,
                                }),
                            },
                            {
                                text: `${retired ? "📌 Use this" : "🪄 In use"}`,
                                callback_data: JSON.stringify({
                                    command: `usewallet_${nonce}`,
                                }),
                            },
                            {
                                text: `🗝 Private key`,
                                callback_data: JSON.stringify({
                                    command: `revealpk_${nonce}`,
                                }),
                            },
                        ];
                    }),
                    [
                        {
                            text: "💳 Generate new wallet",
                            callback_data: JSON.stringify({
                                command: "generate_wallet",
                            }),
                        },
                    ],
                    [
                        {
                            text: `↩️ Back`,
                            callback_data: JSON.stringify({
                                command: "settings",
                            }),
                        },
                        {
                            text: `❌ Close`,
                            callback_data: JSON.stringify({
                                command: "dismiss_message",
                            }),
                        },
                    ],
                ],
            },
        });
    }
    catch (e) {
        console.log("~walletViewHandler~", e);
    }
};
exports.walletViewHandler = walletViewHandler;
const generateNewWalletHandler = async (bot, msg) => {
    try {
        const { chat } = msg;
        const { id: chat_id, username, first_name, last_name } = chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const users = await UserService.find({ username });
        if (users.length >= MAX_WALLET) {
            const limitcaption = `<b>You have generated too many wallets. Max limit: ${MAX_WALLET}.</b>\n` +
                `<i>If you need any help, please contact support team.</i>`;
            const sentmsg = await bot.sendMessage(chat_id, limitcaption, {
                parse_mode: "HTML",
            });
            (0, common_screen_1.deleteDelayMessage)(bot, chat_id, sentmsg.message_id, 10000);
            return;
        }
        // find unique private_key
        let retries = 0;
        let userdata = null;
        let private_key = "";
        let wallet_address = "";
        do {
            const keypair = web3_js_1.Keypair.generate();
            private_key = bs58_1.default.encode(keypair.secretKey);
            wallet_address = keypair.publicKey.toString();
            const wallet = await UserService.findOne({ wallet_address });
            if (!wallet) {
                // add
                const nonce = users.length;
                if (users.length > 0) {
                    const olduser = users[0];
                    const newUser = {
                        chat_id,
                        first_name,
                        last_name,
                        username,
                        wallet_address,
                        private_key,
                        nonce,
                        retired: true,
                        preset_setting: olduser.preset_setting,
                        referrer_code: olduser.referrer_code,
                        referrer_wallet: olduser.referrer_wallet,
                        referral_code: olduser.referral_code,
                        referral_date: olduser.referral_date,
                        schedule: olduser.schedule,
                        auto_buy: olduser.auto_buy,
                        auto_buy_amount: olduser.auto_buy_amount,
                        auto_sell_amount: olduser.auto_sell_amount,
                        burn_fee: olduser.burn_fee,
                    };
                    userdata = await UserService.create(newUser); // true; //
                }
                else {
                    const newUser = {
                        chat_id,
                        username,
                        first_name,
                        last_name,
                        wallet_address,
                        private_key,
                        nonce,
                        retired: true,
                    };
                    userdata = await UserService.create(newUser); // true; //
                }
            }
            else {
                retries++;
            }
        } while (retries < 5 && !userdata);
        // impossible to create
        if (!userdata) {
            await bot.sendMessage(chat_id, "Sorry, we cannot create your account. Please contact support team");
            return;
        }
        // send private key & wallet address
        const caption = `👍 Congrates! 👋\n\n` +
            `A new wallet has been generated for you. This is your wallet address\n\n` +
            `${wallet_address}\n\n` +
            `<b>Save this private key below</b>❗\n\n` +
            `<tg-spoiler>${private_key}</tg-spoiler>\n\n`;
        await bot.sendMessage(chat_id, caption, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "❌ Dismiss message",
                            callback_data: JSON.stringify({
                                command: "dismiss_message",
                            }),
                        },
                    ],
                ],
            },
        });
        (0, exports.settingScreenHandler)(bot, msg, msg.message_id);
    }
    catch (e) {
        console.log("~generateNewWalletHandler~", e);
    }
};
exports.generateNewWalletHandler = generateNewWalletHandler;
const revealWalletPrivatekyHandler = async (bot, msg, nonce) => {
    try {
        const { chat } = msg;
        const { id: chat_id, username, first_name, last_name } = chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        console.log(username, nonce);
        const user = await UserService.findLastOne({ username, nonce });
        console.log(user);
        if (!user)
            return;
        // send private key & wallet address
        const caption = `🗝 <b>Your private key</b>\n` +
            `<tg-spoiler>${user.private_key}</tg-spoiler>\n\n`;
        await bot.sendMessage(chat_id, caption, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "❌ Dismiss message",
                            callback_data: JSON.stringify({
                                command: "dismiss_message",
                            }),
                        },
                    ],
                ],
            },
        });
        // settingScreenHandler(bot, msg, msg.message_id);
    }
    catch (e) {
        console.log("~revealWalletPrivatekyHandler~", e);
    }
};
exports.revealWalletPrivatekyHandler = revealWalletPrivatekyHandler;
const switchWalletHandler = async (bot, msg, nonce) => {
    try {
        const { chat } = msg;
        const { username } = chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        await UserService.findAndUpdateOne({ username, retired: false }, { retired: true });
        await UserService.findAndUpdateOne({ username, nonce }, { retired: false });
        const sentmsg = await bot.sendMessage(chat.id, "Successfully updated");
        (0, common_screen_1.deleteDelayMessage)(bot, chat.id, sentmsg.message_id, 5000);
        (0, exports.settingScreenHandler)(bot, msg, msg.message_id);
    }
    catch (e) {
        console.log("~switchWalletHandler~", e);
    }
};
exports.switchWalletHandler = switchWalletHandler;
const setCustomBuyPresetHandler = async (bot, msg, amount, reply_message_id) => {
    try {
        const { id: chat_id, username } = msg.chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        let key = "preset_index" + username;
        let preset_index = (await redisClient.get(key)) ?? "0";
        const user = await UserService.findOne({ username });
        let presetSetting = user?.preset_setting ?? [0.1, 1, 5, 10];
        presetSetting.splice(parseInt(preset_index), 1, amount);
        await UserService.updateMany({ username }, { preset_setting: presetSetting });
        const sentSuccessMsg = await bot.sendMessage(chat_id, "Preset value changed successfully!");
        setTimeout(() => {
            bot.deleteMessage(chat_id, sentSuccessMsg.message_id);
        }, 3000);
        setTimeout(() => {
            bot.deleteMessage(chat_id, reply_message_id - 1);
            bot.deleteMessage(chat_id, reply_message_id);
            bot.deleteMessage(chat_id, msg.message_id);
        }, 2000);
    }
    catch (e) {
        console.log("~ setCustomBuyPresetHandler ~", e);
    }
};
exports.setCustomBuyPresetHandler = setCustomBuyPresetHandler;
const changeGasFeeHandler = async (bot, msg, gasfee) => {
    const chat_id = msg.chat.id;
    const caption = msg.text;
    const username = msg.chat.username;
    const reply_markup = msg.reply_markup;
    if (!caption || !username || !reply_markup)
        return;
    const gasSetting = await UserTradeSettingService.getGas(username);
    const nextFeeOption = UserTradeSettingService.getNextGasFeeOption(gasSetting.gas);
    const nextValue = UserTradeSettingService.getGasValue({
        gas: nextFeeOption,
        value: gasSetting.value,
    });
    await UserTradeSettingService.setGas(username, {
        gas: nextFeeOption,
        value: gasSetting.value,
    });
    let inline_keyboard = reply_markup.inline_keyboard;
    inline_keyboard[6] = [
        {
            text: `🔁 ${nextFeeOption === GasFeeEnum.HIGH
                ? "High"
                : nextFeeOption === GasFeeEnum.MEDIUM
                    ? "Medium"
                    : nextFeeOption === GasFeeEnum.LOW
                        ? "Low"
                        : "custom"}`,
            callback_data: JSON.stringify({
                command: `switch_gas`,
            }),
        },
        {
            text: `⚙️ ${nextValue} SOL`,
            callback_data: JSON.stringify({
                command: `custom_gas`,
            }),
        },
    ];
    bot.sendMessage(chat_id, `Gas fee set to ${nextFeeOption}.`);
    await bot.editMessageReplyMarkup({
        inline_keyboard,
    }, {
        message_id: msg.message_id,
        chat_id,
    });
};
exports.changeGasFeeHandler = changeGasFeeHandler;
const setCustomFeeScreenHandler = async (bot, msg) => {
    try {
        const chat_id = msg.chat.id;
        const username = msg.chat.username;
        const user = await UserService.findOne({ username });
        if (!user)
            return;
        const sentMessage = await bot.sendMessage(chat_id, SET_GAS_FEE, {
            parse_mode: "HTML",
            reply_markup: {
                force_reply: true,
            },
        });
        await MsgLogService.create({
            username,
            wallet_address: user.wallet_address,
            chat_id,
            msg_id: sentMessage.message_id,
            parent_msgid: msg.message_id,
        });
    }
    catch (e) {
        console.log("~ setCustomFeeScreenHandler ~", e);
    }
};
exports.setCustomFeeScreenHandler = setCustomFeeScreenHandler;
const setCustomFeeHandler = async (bot, msg, amount, reply_message_id) => {
    try {
        const { id: chat_id, username } = msg.chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        // user
        const user = await UserService.findOne({ username });
        if (!user) {
            await (0, common_screen_1.sendNoneUserNotification)(bot, msg);
            return;
        }
        const { auto_buy, auto_buy_amount } = user;
        const msgLog = await MsgLogService.findOne({
            username,
            msg_id: reply_message_id,
        });
        if (!msgLog) {
            return;
        }
        const parent_msgid = msgLog.parent_msgid;
        const parentMsgLog = await MsgLogService.findOne({
            username,
            msg_id: parent_msgid,
        });
        if (!parentMsgLog) {
            return;
        }
        const { mint, extra_key } = parentMsgLog;
        await UserTradeSettingService.setGas(username, {
            gas: GasFeeEnum.CUSTOM,
            value: amount,
        });
        bot.deleteMessage(chat_id, msg.message_id);
        bot.deleteMessage(chat_id, reply_message_id);
        const reply_markup = await (0, exports.getReplyOptionsForSettings)(username, auto_buy, auto_buy_amount);
        bot.sendMessage(chat_id, `Gas fee set to ${amount} SOL.`);
        await bot.editMessageReplyMarkup(reply_markup, {
            message_id: parent_msgid,
            chat_id,
        });
    }
    catch (e) {
        console.log("~ setCustomBuyPresetHandler ~", e);
    }
};
exports.setCustomFeeHandler = setCustomFeeHandler;
const setCustomAutoBuyAmountHandler = async (bot, msg, amount, reply_message_id) => {
    try {
        const { id: chat_id, username } = msg.chat;
        const message_id = msg.message_id;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const user = await UserService.findOne({ username });
        if (!user) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        await UserService.updateMany({ username }, { auto_buy_amount: amount });
        const sentSuccessMsg = await bot.sendMessage(chat_id, "AutoBuy amount changed successfully!");
        const key = "autobuy_amount" + username;
        const replaceId = (await redisClient.get(key)) ?? "0";
        (0, exports.settingScreenHandler)(bot, msg, parseInt(replaceId));
        setTimeout(() => {
            bot.deleteMessage(chat_id, sentSuccessMsg.message_id);
        }, 3000);
        setTimeout(() => {
            // bot.deleteMessage(chat_id, reply_message_id - 1);
            bot.deleteMessage(chat_id, reply_message_id);
            bot.deleteMessage(chat_id, msg.message_id);
        }, 2000);
    }
    catch (e) {
        console.log("~ setCustomAutoBuyHandler ~", e);
    }
};
exports.setCustomAutoBuyAmountHandler = setCustomAutoBuyAmountHandler;
const switchBurnOptsHandler = async (bot, msg) => {
    try {
        const message_id = msg.message_id;
        const sentMessage = await bot.sendMessage(msg.chat.id, "Updating...");
        const username = msg.chat.username;
        if (!username) {
            await bot.deleteMessage(msg.chat.id, message_id);
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const user = await UserService.findOne({ username });
        if (!user) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            await bot.deleteMessage(msg.chat.id, sentMessage.message_id);
            return;
        }
        await UserService.updateMany({ username }, { burn_fee: !user.burn_fee });
        // console.log("🚀 ~ switchBurnOptsHandler ~ user.burn_fee:", user.burn_fee)
        if (!user.burn_fee) {
            const caption = `Burn: On 🔥\n\n` +
                `GrowTrade's burn functionality operates seamlessly through its fee system, where a portion of tokens bought and sold is systematically burned. This process does not affect users' own tokens but only those acquired through the fee mechanism, ensuring the safety of your trades.`;
            bot.sendMessage(msg.chat.id, caption, common_screen_1.closeReplyMarkup);
        }
        const reply_markup = {
            inline_keyboard: welcome_screen_1.welcomeKeyboardList.map((rowItem) => rowItem.map((item) => {
                if (item.command.includes("bridge")) {
                    return {
                        text: item.text,
                        url: "https://t.me/growbridge_bot",
                    };
                }
                if (item.text.includes("Burn")) {
                    const burnText = `${!user.burn_fee ? "Burn: On 🔥" : "Burn: Off ♨️"}`;
                    return {
                        text: burnText,
                        callback_data: JSON.stringify({
                            command: item.command,
                        }),
                    };
                }
                return {
                    text: item.text,
                    callback_data: JSON.stringify({
                        command: item.command,
                    }),
                };
            })),
        };
        await bot.editMessageReplyMarkup(reply_markup, {
            message_id,
            chat_id: msg.chat.id,
        });
        await bot.deleteMessage(msg.chat.id, sentMessage.message_id);
    }
    catch (error) {
        console.log("🚀 ~ switchBurnOptsHandler ~ error:", error);
    }
};
exports.switchBurnOptsHandler = switchBurnOptsHandler;
const switchAutoBuyOptsHandler = async (bot, msg) => {
    try {
        const message_id = msg.message_id;
        const sentMessage = await bot.sendMessage(msg.chat.id, "Updating...");
        const username = msg.chat.username;
        if (!username) {
            await bot.deleteMessage(msg.chat.id, sentMessage.message_id);
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        const user = await UserService.findOne({ username });
        if (!user) {
            await bot.deleteMessage(msg.chat.id, sentMessage.message_id);
            await (0, common_screen_1.sendNoneUserNotification)(bot, msg);
            return;
        }
        const isAutoBuy = !user.auto_buy;
        await UserService.updateMany({ username }, { auto_buy: isAutoBuy });
        const reply_markup = await (0, exports.getReplyOptionsForSettings)(username, isAutoBuy, user.auto_buy_amount);
        await bot.editMessageReplyMarkup(reply_markup, {
            message_id,
            chat_id: msg.chat.id,
        });
        await bot.deleteMessage(msg.chat.id, sentMessage.message_id);
    }
    catch (error) {
        console.log("🚀 ~ switchAutoBuyOptsHandler ~ error:", error);
    }
};
exports.switchAutoBuyOptsHandler = switchAutoBuyOptsHandler;
const getReplyOptionsForSettings = async (username, auto_buy, auto_buy_amount) => {
    // Slippage
    const slippageSetting = await UserTradeSettingService.getSlippage(username);
    const gasSetting = await UserTradeSettingService.getGas(username);
    const gasvalue = UserTradeSettingService.getGasValue(gasSetting);
    // JitoFee
    const jitoFeeSetting = await UserTradeSettingService.getJitoFee(username);
    const jitoFeeValue = UserTradeSettingService.getJitoFeeValue(jitoFeeSetting);
    const { slippage } = slippageSetting;
    const reply_markup = {
        inline_keyboard: [
            [
                {
                    text: `💳 Wallet`,
                    callback_data: JSON.stringify({
                        command: `wallet_view`,
                    }),
                },
                {
                    text: `🗒  Preset Settings`,
                    callback_data: JSON.stringify({
                        command: `preset_setting`,
                    }),
                },
            ],
            [
                {
                    text: "♻️ Withdraw",
                    callback_data: JSON.stringify({
                        command: `transfer_funds`,
                    }),
                },
                {
                    text: `〰️ Slippage: ${slippage} %`,
                    callback_data: JSON.stringify({
                        command: `set_slippage`,
                    }),
                },
            ],
            [
                {
                    text: `${!auto_buy ? "Autobuy ☑️" : "Autobuy ✅"}`,
                    callback_data: JSON.stringify({
                        command: `autobuy_switch`,
                    }),
                },
                {
                    text: `${auto_buy_amount} SOL`,
                    callback_data: JSON.stringify({
                        command: `autobuy_amount`,
                    }),
                },
            ],
            [
                {
                    text: "--- MEV PROTECT ---",
                    callback_data: JSON.stringify({
                        command: `dump`,
                    }),
                },
            ],
            [
                {
                    text: `🔁 ${jitoFeeSetting.jitoOption}`,
                    callback_data: JSON.stringify({
                        command: `switch_mev`,
                    }),
                },
                {
                    text: `⚙️ ${jitoFeeValue} SOL`,
                    callback_data: JSON.stringify({
                        command: `custom_jitofee`,
                    }),
                },
            ],
            [
                {
                    text: "--- PRIORITY FEES ---",
                    callback_data: JSON.stringify({
                        command: `dump`,
                    }),
                },
            ],
            [
                {
                    text: `🔁 ${gasSetting.gas === GasFeeEnum.HIGH
                        ? "high"
                        : gasSetting.gas === GasFeeEnum.MEDIUM
                            ? "medium"
                            : gasSetting.gas === GasFeeEnum.LOW
                                ? "low"
                                : "custom"}`,
                    callback_data: JSON.stringify({
                        command: "switch_gas",
                    }),
                },
                {
                    text: `⚙️ ${gasvalue} SOL`,
                    callback_data: JSON.stringify({
                        command: "custom_gas",
                    }),
                },
            ],
            [
                {
                    text: "↩️ Back",
                    callback_data: JSON.stringify({
                        command: "back_home",
                    }),
                },
                {
                    text: "❌ Close",
                    callback_data: JSON.stringify({
                        command: "dismiss_message",
                    }),
                },
            ],
        ],
    };
    return reply_markup;
};
exports.getReplyOptionsForSettings = getReplyOptionsForSettings;
const changeJitoTipFeeHandler = async (bot, msg) => {
    const chat_id = msg.chat.id;
    const caption = msg.text;
    const username = msg.chat.username;
    const reply_markup = msg.reply_markup;
    if (!caption || !username || !reply_markup)
        return;
    const { jitoOption, value } = await UserTradeSettingService.getJitoFee(username);
    const nextFeeOption = UserTradeSettingService.getNextJitoFeeOption(jitoOption);
    const nextValue = UserTradeSettingService.getJitoFeeValue({
        jitoOption: nextFeeOption,
    });
    await UserTradeSettingService.setJitoFee(username, {
        jitoOption: nextFeeOption,
        value: nextValue,
    });
    let inline_keyboard = reply_markup.inline_keyboard;
    inline_keyboard[4] = [
        {
            text: `🔁 ${nextFeeOption}`,
            callback_data: JSON.stringify({
                command: `switch_mev`,
            }),
        },
        {
            text: `⚙️ ${nextValue} SOL`,
            callback_data: JSON.stringify({
                command: `custom_jitofee`,
            }),
        },
    ];
    bot.sendMessage(chat_id, `MEV protect set to ${nextFeeOption}.`);
    await bot.editMessageReplyMarkup({
        inline_keyboard,
    }, {
        message_id: msg.message_id,
        chat_id,
    });
};
exports.changeJitoTipFeeHandler = changeJitoTipFeeHandler;
const setCustomJitoFeeScreenHandler = async (bot, msg) => {
    try {
        const chat_id = msg.chat.id;
        const username = msg.chat.username;
        const user = await UserService.findOne({ username });
        if (!user)
            return;
        const sentMessage = await bot.sendMessage(chat_id, SET_JITO_FEE, {
            parse_mode: "HTML",
            reply_markup: {
                force_reply: true,
            },
        });
        await MsgLogService.create({
            username,
            wallet_address: user.wallet_address,
            chat_id,
            msg_id: sentMessage.message_id,
            parent_msgid: msg.message_id,
        });
    }
    catch (e) {
        console.log("~ setCustomFeeScreenHandler ~", e);
    }
};
exports.setCustomJitoFeeScreenHandler = setCustomJitoFeeScreenHandler;
const setCustomJitoFeeHandler = async (bot, msg, amount, reply_message_id) => {
    try {
        const { id: chat_id, username } = msg.chat;
        if (!username) {
            await (0, common_screen_1.sendUsernameRequiredNotification)(bot, msg);
            return;
        }
        // user
        const user = await UserService.findOne({ username });
        if (!user) {
            await (0, common_screen_1.sendNoneUserNotification)(bot, msg);
            return;
        }
        const { auto_buy, auto_buy_amount } = user;
        const msgLog = await MsgLogService.findOne({
            username,
            msg_id: reply_message_id,
        });
        if (!msgLog) {
            return;
        }
        const parent_msgid = msgLog.parent_msgid;
        const parentMsgLog = await MsgLogService.findOne({
            username,
            msg_id: parent_msgid,
        });
        if (!parentMsgLog) {
            return;
        }
        await UserTradeSettingService.setJitoFee(username, {
            jitoOption: JitoFeeEnum.CUSTOM,
            value: amount,
        });
        bot.deleteMessage(chat_id, msg.message_id);
        bot.deleteMessage(chat_id, reply_message_id);
        const reply_markup = await (0, exports.getReplyOptionsForSettings)(username, auto_buy, auto_buy_amount);
        bot.sendMessage(chat_id, `MEV protect set to ${amount} SOL.`);
        await bot.editMessageReplyMarkup(reply_markup, {
            message_id: parent_msgid,
            chat_id,
        });
    }
    catch (e) {
        console.log("~ setCustomBuyPresetHandler ~", e);
    }
};
exports.setCustomJitoFeeHandler = setCustomJitoFeeHandler;
const pnlCardHandler = async (bot, msg) => {
    try {
        const chat_id = msg.chat.id;
        const username = msg.chat.username;
        if (!username)
            return;
        const pendingTxMsg = await bot.sendMessage(chat_id, `🕒 <b>Generating PNL Card...</b>\n`, {
            parse_mode: "HTML",
        });
        const user = await UserService.findOne({ username });
        if (!user) {
            await (0, common_screen_1.sendNoneUserNotification)(bot, msg);
            return;
        }
        const msglog = await MsgLogService.findOne({
            username,
            msg_id: msg.message_id,
        });
        if (!msglog)
            return;
        const { mint } = msglog;
        let tokenSymbol;
        const referrerCode = await (0, referral_link_handler_1.GenerateReferralCode)(username);
        const { symbol } = await TokenService.fetchSimpleMetaData(new web3_js_1.PublicKey(mint));
        tokenSymbol = symbol;
        if (tokenSymbol === "") {
            const tokeninfo = await TokenService.getMintInfo(mint);
            tokenSymbol = tokeninfo?.overview.symbol;
        }
        const solPrice = await TokenService.getSOLPrice();
        const metadata = await TokenService.getMintMetadata(private_connection, new web3_js_1.PublicKey(mint));
        const decimals = metadata?.parsed.info.decimals;
        const isToken2022 = metadata?.program === "spl-token-2022";
        const splbalance = await TokenService.getSPLBalance(mint, user.wallet_address, isToken2022, true);
        let quote;
        const jupiterService = new JupiterService();
        const jupiterTradeable = await jupiterService.checkTradableOnJupiter(mint);
        if (jupiterTradeable) {
            quote = await jupiterService.getQuote(mint, spl_token_1.NATIVE_MINT.toString(), splbalance, Number(decimals), 9);
        }
        else {
            const raydiumPoolInfo = await RaydiumTokenService.findLastOne({ mint });
            if (raydiumPoolInfo) {
                const { name, symbol, mint, poolId, isAmm, ammKeys, clmmKeys } = raydiumPoolInfo;
                quote = (await calcAmountOut(private_connection, new web3_js_1.PublicKey(mint), Number(decimals), spl_token_1.NATIVE_MINT, 9, poolId, splbalance, isAmm, ammKeys, clmmKeys));
            }
            else {
                const coinData = await getCoinData(mint);
                if (!coinData) {
                    console.error("Failed to retrieve coin data...");
                    return;
                }
                const _slippage = 0.25;
                const minSolOutput = Math.floor((splbalance *
                    10 ** Number(decimals) *
                    (1 - _slippage) *
                    coinData["virtual_sol_reserves"]) /
                    coinData["virtual_token_reserves"]);
                quote = {
                    inAmount: splbalance,
                    outAmount: (0, utils_1.fromWeiToValue)(minSolOutput, 9),
                };
            }
        }
        const pnlService = new PNLService(user.wallet_address, mint, quote);
        await pnlService.initialize();
        const pnldata = (await pnlService.getPNLInfo());
        const boughtInSOL = await pnlService.getBoughtAmount();
        const { profitInSOL, percent } = pnldata
            ? pnldata
            : { profitInSOL: Number(0), percent: Number(0) };
        const profitInUSD = profitInSOL * Number(solPrice);
        console.log("PNL data ->", profitInSOL, profitInUSD, solPrice, splbalance, boughtInSOL, pnldata);
        const req = {
            chatId: chat_id,
            pairTitle: `${tokenSymbol}/SOL`,
            boughtAmount: Number(boughtInSOL).toFixed(2),
            pnlValue: Number(profitInSOL).toFixed(2),
            worth: Math.abs(Number(profitInUSD)).toFixed(2),
            profitPercent: Number(percent).toFixed(2),
            burnAmount: Number(0).toFixed(2),
            isBuy: splbalance > 0,
            referralLink: `https://t.me/${TradeBotID}?start=${referrerCode}`,
        };
        const { pnlUrl } = await pnlService.getPNLCard(req);
        console.log(req);
        await bot.deleteMessage(msg.chat.id, pendingTxMsg.message_id);
        await bot.sendPhoto(msg.chat.id, pnlUrl, {
            parse_mode: "HTML",
        });
    }
    catch (e) {
        console.log("~ refresh handler ~", e);
    }
};
exports.pnlCardHandler = pnlCardHandler;
