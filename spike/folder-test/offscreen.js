import { loadHandle, permissionState, writeTestCapture } from './shared.js';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'write-from-offscreen') return;
  (async () => {
    const handle = await loadHandle();
    const permission = await permissionState(handle);
    if (permission !== 'granted') return reply({ ok: false, permission });
    try {
      const r = await writeTestCapture(handle, 'offscreen');
      reply({ ok: true, permission, ...r });
    } catch (e) {
      reply({ ok: false, permission, error: e.message });
    }
  })();
  return true;
});
