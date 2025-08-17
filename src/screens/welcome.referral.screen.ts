let TelegramBot: any;
try { const _tg = require('node-telegram-bot-api'); TelegramBot = _tg.default || _tg; } catch (e) {}
type TelegramBotType = any;
// ...other named imports removed from static import
// original code expected named exports from node-telegram-bot-api; runtime require will provide them as properties if needed.
import {
  KeyboardButton,
  ReplyKeyboardMarkup,
} from "node-telegram-bot-api";
let TradeBotID: any;
let WELCOME_REFERRAL: any;
try { const _b = require('../bot.opts'); TradeBotID = _b.TradeBotID; WELCOME_REFERRAL = _b.WELCOME_REFERRAL; } catch (e) { TradeBotID = WELCOME_REFERRAL = null; }
import { copytoclipboard } from "../utils";
let get_referral_amount: any;
let get_referral_num: any;
try {
  const _r = require("../services/referral.service");
  get_referral_amount = _r.get_referral_amount;
  get_referral_num = _r.get_referral_num;
} catch (e) {
  get_referral_amount = null;
  get_referral_num = null;
}

export const showWelcomeReferralProgramMessage = async (
  bot: TelegramBotType,
  chat: any,
  uniquecode?: string
) => {
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

      const caption =
        `<b>🎉 Welcome to the referral program</b>\n\n` +
        `Please create a unique referral code to get started👇.`;
      await bot.sendPhoto(chatId, WELCOME_REFERRAL, {
        caption: caption,
        reply_markup,
        parse_mode: "HTML",
      });
    } else {
      const reply_markup = {
        inline_keyboard: inlineKeyboards,
      };
      let num = await get_referral_num(uniquecode);
      let totalAmount = await get_referral_amount(uniquecode);
      const referralLink = `https://t.me/${TradeBotID}?start=${uniquecode}`;
      const contents =
        "<b>🎉 Welcome to referral program</b>\n\n" +
        `<b>Refer your friends and earn 25% of their fees in the first 45 days, 20% in the next 45 days and 15% forever!</b>\n\n` +
        `<b>Referred Count: ${num.num}\nSol Earned: ${totalAmount.totalAmount}</b>\n\n` +
        `<b>Your referral code 🔖</b>\n${copytoclipboard(uniquecode)}\n\n` +
        `<b>Your referral link 🔗</b>\n${copytoclipboard(referralLink)}\n\n` +
        // `<i>Note: Don't forget set up payout address to get paid</i>\n\n` +
        `- Share your referral link with whoever you want and earn from their swaps 🔁\n` +
        `- Check profits, payouts and change the payout address 📄\n`;

      await bot.sendPhoto(chatId, WELCOME_REFERRAL, {
        caption: contents,
        reply_markup,
        parse_mode: "HTML",
      });
    }
  } catch (e) {
    console.log("~ showWelcomeReferralProgramMessage Error ~", e);
  }
};
