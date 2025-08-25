#!/usr/bin/env node
// Warm slot_blocktime cache by calling getBlockTimeForSlotCached for slots you specify
// Usage examples:
//   node -r ts-node/register scripts/warm_slot_blocktime_cache.ts --last 5
//   node -r ts-node/register scripts/warm_slot_blocktime_cache.ts --slot 362295420
//   node -r ts-node/register scripts/warm_slot_blocktime_cache.ts --from 362295400 --to 362295410

async function main() {
  try {
    const ff = require('../src/fastTokenFetcher');
    const cfg = require('../src/config');

    const argv = process.argv.slice(2);
    const getArg = (name: string) => {
      const i = argv.indexOf(name);
      if (i === -1) return null;
      return argv[i+1] || null;
    };

    const single = getArg('--slot');
    const from = getArg('--from');
    const to = getArg('--to');
    const last = Number(getArg('--last') || 5);

    let slots: number[] = [];
    if (single) {
      slots = [Number(single)];
    } else if (from && to) {
      const f = Number(from), t = Number(to);
      if (isNaN(f) || isNaN(t) || f > t) throw new Error('invalid from/to');
      for (let s = f; s <= t; s++) slots.push(s);
    } else {
      // default: last N slots
      const conn = cfg && cfg.connection;
      if (!conn || typeof conn.getSlot !== 'function') throw new Error('no connection available (set MAINNET_RPC in env)');
      const curr = await conn.getSlot();
      const start = Math.max(0, curr - Math.max(1, last - 1));
      for (let s = start; s <= curr; s++) slots.push(s);
    }

    console.log('Warming slot_blocktime cache for', slots.length, 'slots');

    for (const slot of slots) {
      try {
        const start = Date.now();
        const bt = await ff.getBlockTimeForSlotCached(Number(slot));
        const took = Date.now() - start;
        console.log(`slot=${slot} -> blockTime=${bt} (ms=${took})`);
      } catch (e) {
        console.warn('slot', slot, 'error', e && e.message ? e.message : e);
      }
    }
    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error('Failed to warm cache:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
