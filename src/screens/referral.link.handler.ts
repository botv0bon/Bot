let TelegramBot: any;
try { const _tg = require('node-telegram-bot-api'); TelegramBot = _tg.default || _tg; } catch (e) {}
type TelegramBotType = any;
import { showWelcomeReferralProgramMessage } from "./welcome.referral.screen";
import { generateReferralCode } from "../utils";
let UserService: any;
try {
  UserService = require("../services/user.service").UserService;
} catch (e) {
  UserService = null;
}
let ReferralChannelService: any;
try {
  ReferralChannelService = require("../services/referral.channel.service").ReferralChannelService;
} catch (e) {
  ReferralChannelService = null;
}

export const OpenReferralWindowHandler = async (
  bot: TelegramBotType,
  msg: TelegramMessage
) => {
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

  const referrerCode = await GenerateReferralCode(username);
  showWelcomeReferralProgramMessage(bot, chat, referrerCode);
};

export const GenerateReferralCode = async (username: string) => {
  const userInfo = await UserService.findOne({ username: username });
  if (!userInfo) return;
  const { referrer_code } = userInfo;

  let referrerCode = "";
  if (referrer_code && referrer_code !== "") {
    referrerCode = referrer_code;
  } else {
    let uniquecode = generateReferralCode(10);
    referrerCode = uniquecode;
    const referralChannelService = new ReferralChannelService();
    const res = await referralChannelService.createReferralChannel(
      username,
      uniquecode
    );
    console.log(res);
    if (!res) return;
    await UserService.updateMany(
      { username: username },
      { referrer_code: uniquecode }
    );
  }

  return referrerCode;
};
