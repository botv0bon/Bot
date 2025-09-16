// Utilities to normalize various listener/collector outputs into a canonical shape
// The user requested that token/event fetchers produce results like:
// ["<mint>"]\n{"time":"...","program":"<prog>","signature":"...","kind":"initialize","freshMints":["..."],"sampleLogs":["..."]}

export type NormalizedMintEvent = {
  mint: string | null;
  time?: string | number | null;
  program?: string | null;
  signature?: string | null;
  kind?: string | null;
  freshMints?: string[] | null;
  sampleLogs?: string[] | null;
  raw?: any;
};

export function normalizeListenerItem(item: any): NormalizedMintEvent | null {
  try {
    if (!item) return null;
    // if item is a simple mint string or array with single string
    if (typeof item === 'string') {
      return { mint: item };
    }
    if (Array.isArray(item) && item.length === 1 && typeof item[0] === 'string') {
      return { mint: item[0] };
    }
    // If item already matches event shape (object with freshMints)
    if (item && typeof item === 'object') {
      // Possible shapes: { time, program, signature, kind, freshMints, sampleLogs }
      const mint = (item.freshMints && Array.isArray(item.freshMints) && item.freshMints[0]) || item.mint || item.address || item.tokenAddress || null;
      const out: NormalizedMintEvent = {
        mint: normalizeMintString(mint),
        time: item.time || item.detectedAt || item.timestamp || item.ts || null,
        program: item.program || item.programId || item.programs || null,
        signature: item.signature || item.sig || item.transactionSignature || null,
        kind: item.kind || item.eventType || null,
        freshMints: Array.isArray(item.freshMints) ? item.freshMints : (item.freshMint ? [item.freshMint] : null),
        sampleLogs: Array.isArray(item.sampleLogs) ? item.sampleLogs : (item.logs ? (Array.isArray(item.logs) ? item.logs : [String(item.logs)]) : null),
        raw: item,
      };
      return out;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function normalizeMintString(v: any): string | null {
  try {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0];
    return null;
  } catch (e) { return null; }
}
