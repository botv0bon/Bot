import dotenv from 'dotenv'; dotenv.config();
const fs = require('fs');
const axios = require('axios');
(async ()=>{
  try{
    const usersRaw = fs.readFileSync('users.json','utf8');
    const users = usersRaw ? JSON.parse(usersRaw) : {};
    const uid = Object.keys(users)[0];
    if(!uid){ console.error('No users in users.json'); process.exit(1); }
    const user = users[uid];
    console.log('Testing for user:', uid);
    console.log('User.strategy:', JSON.stringify(user.strategy, null, 2));

    const HELIUS_RPC = process.env.HELIUS_RPC_URL || process.env.HELIUS_RPC || 'https://mainnet.helius-rpc.com/';
    const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || '';
    const headers = Object.assign({ 'Content-Type': 'application/json' }, HELIUS_KEY ? { 'x-api-key': HELIUS_KEY } : {});
    const PROGRAMS = [
      '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
      'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
      '11111111111111111111111111111111',
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
      '9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp',
      'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu'
    ];

    async function heliusRpc(method: string, params: any){
      try{
        const res = await axios.post(HELIUS_RPC, { jsonrpc:'2.0', id:1, method, params }, { headers, timeout:15000 });
        return res.data && (res.data.result || res.data);
      }catch(e){
        console.error('heliusRpc error', method, (e && e.message) || e);
        return null;
      }
    }

    function extractMints(tx:any){
      const s = new Set();
      try{
        const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {};
        const arr = [].concat(meta.preTokenBalances||[], meta.postTokenBalances||[]);
        for(const b of arr) if(b && b.mint) s.add(b.mint);
        const inner = meta.innerInstructions || [];
        for(const block of inner){
          const instrs = block && block.instructions || [];
          for(const ins of instrs){
            try{
              const pt = ins && ins.parsed && ins.parsed.info && (ins.parsed.info.mint || ins.parsed.info.postTokenBalances);
              if(pt){ if(Array.isArray(pt)) for(const x of pt) if(x && x.mint) s.add(x.mint); else if(pt) s.add(pt); }
            }catch(e){}
          }
        }
      }catch(e){}
      return Array.from(s);
    }

    function txKindExplicit(tx:any){
      try{
        const meta = tx && (tx.meta || (tx.transaction && tx.meta)) || {};
        const logs = Array.isArray(meta.logMessages)? meta.logMessages.join('\n').toLowerCase() : '';
        if(logs.includes('instruction: initializemint') || logs.includes('initialize mint') || logs.includes('instruction: initialize_mint')) return 'initialize';
        if(logs.includes('createpool') || logs.includes('initializepool') || logs.includes('create pool')) return 'pool_creation';
        if(logs.includes('instruction: swap') || logs.includes('\nprogram log: instruction: swap') || logs.includes(' swap ')) return 'swap';
        const msg = tx && (tx.transaction && tx.transaction.message) || tx.transaction || {};
        const instrs = (msg && msg.instructions) || [];
        for(const ins of instrs){
          try{ const t = (ins.parsed && ins.parsed.type) || (ins.type || ''); if(!t) continue; const lt = String(t).toLowerCase(); if(lt.includes('initializemint')||lt.includes('initialize_mint')||lt.includes('initialize mint')) return 'initialize'; if(lt.includes('createpool')||lt.includes('initializepool')||lt.includes('create pool')) return 'pool_creation'; if(lt.includes('swap')) return 'swap'; }catch(e){}
        }
      }catch(e){}
      return null;
    }

    const candidateTokens: any[] = [];
    console.log('\nListening one cycle across programs (single recent tx per program) ...\n');
    for(const p of PROGRAMS){
      try{
        const sigs = await heliusRpc('getSignaturesForAddress', [p, { limit: 1 }]);
        if(!Array.isArray(sigs) || sigs.length===0) { continue; }
        const s = sigs[0];
        const sig = s.signature||s.txHash||s.sig||s.txhash; if(!sig) continue;
        const tx = await heliusRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        if(!tx) continue;
        const kind = txKindExplicit(tx); if(!kind) continue;
        const mints = extractMints(tx).filter(Boolean);
        if(!mints || mints.length===0) continue;
        console.log('Program', p, 'sig', sig, 'kind', kind, 'mints', mints.slice(0,5));
        for(const m of mints){
          // lightweight first-tx enrichment
          const tok:any = { address:m, tokenAddress:m, mint:m, sourceProgram:p, sourceSignature:sig, detectedKind:kind };
          try{
            const msigs = await heliusRpc('getSignaturesForAddress', [m, { limit: 1 }]);
            if(Array.isArray(msigs) && msigs.length>0){ const s0 = msigs[0]; const bt = s0.blockTime||s0.block_time||s0.blocktime||null; if(bt) tok.freshnessDetails = { firstTxMs: Number(bt)*1000 }; }
          }catch(e){}
          candidateTokens.push(tok);
        }
      }catch(e){ console.error('program loop error', e); }
    }

    // Basic dedupe and system-token exclusion to emulate listener prefilter
    const systemPatterns = [/^So11111111111111111111111111111111111111112$/, /^11111111111111111111111111111111$/, /TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA/];
    const seen = new Set();
  const filteredCandidates: any[] = [];
    for (const c of candidateTokens) {
      const key = String(c && (c.tokenAddress || c.address || c.mint || '')).trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      let isSystem = false;
      for (const p of systemPatterns) if (p.test(key)) { isSystem = true; break; }
      if (isSystem) continue;
      seen.add(key);
      filteredCandidates.push(c);
    }
    console.log('\nCandidate tokens from listener (total):', filteredCandidates.length);
    console.log(JSON.stringify(filteredCandidates, null, 2));

    // Now apply per-user strategy filter using strategy module
    try{
      const strategyModule = require('../src/bot/strategy');
      const filterTokensByStrategy = strategyModule.filterTokensByStrategy;
      if(!filterTokensByStrategy) { console.error('filterTokensByStrategy not found'); process.exit(1); }
    console.log('\nApplying filterTokensByStrategy(...) with enrichment allowed (accurate path)\n');
  const matched = await filterTokensByStrategy(filteredCandidates, user.strategy, { fastOnly: false, preserveSources: true });
      console.log('\nMatched tokens count:', Array.isArray(matched)? matched.length : 0);
      console.log(JSON.stringify(matched, null, 2));
      // Check whether matched tokens have Dex fields (e.g., price, name)
      const enriched = (matched || []).map((t:any)=>({ addr: t.address||t.tokenAddress||t.mint, price: t.priceUsd||t.price||null, name: t.name||t.symbol||null }));
      console.log('\nMatched tokens (addr, price, name):', JSON.stringify(enriched, null, 2));
    }catch(e){ console.error('strategy filter error', e); }

  }catch(e){ console.error('fatal', e); process.exit(1); }
  process.exit(0);
})();
