export function extractTradeMeta(result: any, mode: 'buy' | 'sell') {
  let fee = null, slippage = null;
  if (!result) return { fee: null, slippage: null };
  fee = result.fee ?? result.feeAmount ?? result.fee_in_sol ?? result.fee_in_token ?? null;
  slippage = result.slippage ?? result.slippagePct ?? null;
  return { fee, slippage };
}
