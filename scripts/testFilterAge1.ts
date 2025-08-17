// Quick test: filter tokens with ageMinutes <= 1 and volume >= 3000
require('dotenv').config();
const axios = require('axios');
(async function(){
  try {
    const tokenUtils = require('../src/utils/tokenUtils');
    let tokens = [];
    if (typeof tokenUtils.fetchDexScreenerTokens === 'function') {
      tokens = await tokenUtils.fetchDexScreenerTokens('solana', { limit: '500' });
      console.log('Fetched tokens via tokenUtils:', tokens.length);
    }
    if (!tokens || tokens.length === 0) {
      const DEX_ENDPOINT = process.env.DEXSCREENER_API_ENDPOINT_BOOSTS || process.env.DEXSCREENER_API_ENDPOINT || 'https://api.dexscreener.com/token-boosts/latest/v1';
      const res = await axios.get(DEX_ENDPOINT);
      tokens = Array.isArray(res.data) ? res.data : (res.data?.tokens || []);
      console.log('Fetched tokens from endpoint:', tokens.length);
    }
    const { getField } = require('../src/utils/tokenUtils');
    // Apply filters: volume >= 3000 and ageMinutes <= 1
    const matched = tokens.filter(t => {
      const volume = Number(getField(t, 'volume', 'volume24h', 'amount', 'totalAmount', 'baseToken.volume')) || 0;
      // ensure ageMinutes normalized
      let age = t.ageMinutes;
      if ((age === undefined || age === null) && t.poolOpenTime) {
        const ct = Number(t.poolOpenTime);
        if (!isNaN(ct)) {
          const millis = ct > 1e12 ? ct : (ct > 1e9 ? ct * 1000 : ct);
          age = Math.floor((Date.now() - millis) / 60000);
        }
      }
      age = typeof age === 'number' ? age : undefined;
      return volume >= 3000 && typeof age === 'number' && age <= 1;
    });
    console.log('Tokens with volume >= 3000 and ageMinutes <= 1:', matched.length);
    if (matched.length > 0) {
      console.log('Sample:', matched.slice(0,10).map(t => ({ address: t.tokenAddress || t.address || t.pairAddress, price: (t.priceUsd || t.price || t.priceUsd), ageMinutes: t.ageMinutes })));
    } else {
      console.log('No tokens match the strict age<=1 minute filter.');
    }
  } catch (e) {
    console.error('Test script error:', e?.message || e);
  }
})();
