import { loadHandle, saveHandle, permissionState, writeTestCapture } from './shared.js';

const $ = (id) => document.getElementById(id);

async function log(entry) {
  const { results = [] } = await chrome.storage.local.get('results');
  results.unshift({ at: new Date().toISOString(), ...entry });
  await chrome.storage.local.set({ results: results.slice(0, 50) });
}

async function render() {
  const handle = await loadHandle();
  const perm = await permissionState(handle);
  $('folder').textContent = handle ? handle.name : 'none yet';
  $('perm').textContent = perm;
  $('perm').className = perm === 'granted' ? 'ok' : 'bad';
  const { results = [] } = await chrome.storage.local.get('results');
  $('log').textContent = results
    .map((r) => `${r.at.slice(11, 19)}  ${r.path}  ${r.ok ? 'OK' : 'FAILED'}${r.ms != null ? ` ${r.ms}ms` : ''}${r.permission ? ` [${r.permission}]` : ''}${r.error ? ` ${r.error}` : ''}`)
    .join('\n');
}

async function write(path) {
  const handle = await loadHandle();
  if (!handle) return { ok: false, error: 'pick a folder first' };
  let permission = await permissionState(handle);
  if (permission !== 'granted' && navigator.userActivation?.isActive) {
    permission = await handle.requestPermission({ mode: 'readwrite' });
  }
  if (permission !== 'granted') return { ok: false, permission };
  try {
    const r = await writeTestCapture(handle, 'panel');
    return { ok: true, permission, ...r };
  } catch (e) {
    return { ok: false, permission, error: e.message };
  }
}

$('pick').onclick = async () => {
  try {
    const handle = await window.showDirectoryPicker({ id: 'project', mode: 'readwrite' });
    await saveHandle(handle);
    await log({ path: 'picked folder', ok: true, permission: await permissionState(handle) });
  } catch (e) {
    await log({ path: 'picked folder', ok: false, error: e.message });
  }
  render();
};

$('write').onclick = async () => {
  await log({ path: 'button in panel', ...(await write('button')) });
  render();
};

$('allow').onclick = async () => {
  const handle = await loadHandle();
  if (!handle) return;
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  await log({ path: 'allow again', ok: permission === 'granted', permission });
  render();
};

$('copy').onclick = async () => {
  const { results = [] } = await chrome.storage.local.get('results');
  const report = JSON.stringify({ browser: navigator.userAgent, platform: navigator.platform, results }, null, 2);
  await navigator.clipboard.writeText(report);
  $('copy').textContent = 'Copied. Paste it in our chat.';
};

// The hotkey asks an open panel to write.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'write-from-panel') return;
  write('hotkey').then((r) => { reply(r); setTimeout(render, 100); });
  return true;
});

chrome.storage.onChanged.addListener(render);

// Record the access state every time the panel opens (key for the restart check).
(async () => {
  const handle = await loadHandle();
  if (handle) await log({ path: 'panel opened', ok: true, permission: await permissionState(handle) });
  render();
})();
