// Runtime enforcement for canonical-only production mode.
// When CANONICAL_ONLY=true (default in production), ensure that all normal
// logging goes to stderr and stdout is reserved only for canonical two-line streams.
const CANONICAL_ONLY = String(process.env.CANONICAL_ONLY ?? 'true').toLowerCase() === 'true';
const HARD_FAIL = String(process.env.CANONICAL_HARD_FAIL || '').toLowerCase() === 'true';
(function enforce(){
  if(!CANONICAL_ONLY) return;
  try{
    // Patch console methods to write to stderr to avoid mixing with canonical stdout
    ['log','info','warn','debug'].forEach(k => {
      try{ console[k] = function(...args: any[]){ try{ process.stderr.write(String(args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' '))+'\n'); }catch(e){} }; }catch(e){}
    });
    // Optionally make console.error also write to stderr (already does), but keep it as-is
    // Patch process.stdout.write to detect non-canonical writes if HARD_FAIL enabled
    if(HARD_FAIL){
      const orig = process.stdout.write.bind(process.stdout);
      process.stdout.write = function(chunk: any, encoding?: any, cb?: any){
        // Heuristic: allow lines that look like JSON array or JSON object
        try{
          const s = String(chunk || '');
          const trimmed = s.trim();
          if(trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')){
            return orig(chunk, encoding, cb);
          }
        }catch(e){}
        // Unexpected stdout write
        try{ process.stderr.write('[ENFORCE_CANONICAL] unexpected stdout write suppressed\n'); }catch(e){}
        throw new Error('Unexpected stdout write when CANONICAL_HARD_FAIL=true');
      } as any;
    }
  }catch(e){}
})();

export {};
