import { unifiedBuy, unifiedSell } from '../tradeSources';
import { saveUsers } from './helpers';

export function registerBuySellHandlers(bot: any, users: Record<string, any>, boughtTokens: Record<string, Set<string>>) {
  bot.action(/buy_(.+)/, async (ctx: any) => {
    const userId = String(ctx.from?.id);
    const user = users[userId];
    const tokenAddress = ctx.match[1];
    if (!user || !user.secret || !user.strategy || !user.strategy.enabled) {
      await ctx.reply('❌ لا يوجد استراتيجية أو محفظة مفعلة.');
      return;
    }
    await ctx.reply('⏳ جاري تنفيذ عملية الشراء، يرجى الانتظار...', { parse_mode: 'HTML' });
    try {
      const amount = 0.01;
      const result = await unifiedBuy(tokenAddress, amount, user.secret);
      if (result?.tx) {
        if (!boughtTokens[userId]) boughtTokens[userId] = new Set();
        boughtTokens[userId].add(tokenAddress);
        if (user) {
          const entry = `ManualBuy: ${tokenAddress} | Amount: ${amount} SOL | Source: unifiedBuy | Tx: ${result.tx}`;
          user.history = user.history || [];
          user.history.push(entry);
          saveUsers(users);
        }
        ctx.reply(`✅ تم شراء الرمز بنجاح!\n<a href='https://solscan.io/tx/${result.tx}'>View Tx</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });
      } else {
        ctx.reply('❌ فشل الشراء: لم يتم تنفيذ العملية.');
      }
    } catch (e: any) {
      ctx.reply(`❌ حدث خطأ أثناء الشراء: ${e?.message || e}`);
    }
  });

  bot.action(/sell_(.+)/, async (ctx: any) => {
    const userId = String(ctx.from?.id);
    const user = users[userId];
    const tokenAddress = ctx.match[1];
    if (!user || !user.secret || !user.strategy || !user.strategy.enabled) {
      await ctx.reply('❌ لا يوجد استراتيجية أو محفظة مفعلة.');
      return;
    }
    await ctx.reply('⏳ جاري تنفيذ عملية البيع، يرجى الانتظار...', { parse_mode: 'HTML' });
    try {
      const amount = 0.01;
      const result = await unifiedSell(tokenAddress, amount, user.secret);
      if (result?.tx) {
        if (boughtTokens[userId]) boughtTokens[userId].delete(tokenAddress);
        if (user) {
          const entry = `Sell: ${tokenAddress} | Amount: ${amount} SOL | Source: unifiedSell | Tx: ${result.tx}`;
          user.history = user.history || [];
          user.history.push(entry);
          saveUsers(users);
        }
        ctx.reply(`✅ تم بيع الرمز بنجاح!\n<a href='https://solscan.io/tx/${result.tx}'>View Tx</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });
      } else {
        ctx.reply('❌ فشل البيع: لم يتم تنفيذ العملية.');
      }
    } catch (e: any) {
      ctx.reply(`❌ حدث خطأ أثناء البيع: ${e?.message || e}`);
    }
  });
}
