import { startHeliusWebsocketListener, getRecentHeliusEvents } from './src/heliusWsListener';
import { handleNewMintEvent } from './src/fastTokenFetcher';

(async () => {
  try {
    console.log('Starting Helius listener for 12s...');
    const inst = await startHeliusWebsocketListener({ onOpen: () => console.log('WS open'), onMessage: () => {}, onClose: () => console.log('WS closed'), onError: (e: any) => console.warn('WS error', e && e.message) });
    // collect for 12 seconds
    await new Promise(r => setTimeout(r, 12_000));
    const evs = getRecentHeliusEvents();
    console.log('Captured events:', evs.length);
    const toCall = (evs || []).slice(0, 8);
    for (const e of toCall) {
      try {
        console.log('\nCalling handleNewMintEvent for', e.mint, 'firstSlot=', e.firstSlot || (e.raw && e.raw.params && e.raw.params.result && e.raw.params.result.context && e.raw.params.result.context.slot));
        const res = await handleNewMintEvent(e, {}, null);
        console.log('result:', res);
      } catch (err) { console.error('call err', err && (err as any).message ? (err as any).message : err); }
    }
    try { if (inst && inst.stop) await inst.stop(); } catch (e) {}
  } catch (e) { console.error('failed', e && (e as any).message ? (e as any).message : e); process.exit(1); }
})();
