// Background for the folder write test (version 2).
// Clicking the toolbar icon opens the side panel.
// The hotkey (Alt+Shift+B) tests writing when the panel is closed, and opening the panel.
//
// Version 2 changes, after Maruthi's first run on 2026-10-31:
// - sidePanel.open() is called first, with no waiting before it, so Chrome still counts the hotkey as a user gesture.
// - A hidden offscreen page is kept open from startup, to test whether folder access survives closing the panel.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function log(entry) {
  const { results = [] } = await chrome.storage.local.get('results');
  results.unshift({ at: new Date().toISOString(), version: 2, ...entry });
  await chrome.storage.local.set({ results: results.slice(0, 50) });
}

let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Write capture files to the linked project folder',
    })
    .finally(() => (creating = null));
  await creating;
}

chrome.runtime.onStartup.addListener(ensureOffscreen);
chrome.runtime.onInstalled.addListener(ensureOffscreen);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'ensure-offscreen') {
    ensureOffscreen().then(() => reply(true), (e) => reply(e.message));
    return true;
  }
  if (msg.type === 'check-offscreen') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ type: 'offscreen-permission' }))
      .then(reply, (e) => reply({ error: e.message }));
    return true;
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'write-test-capture') return;

  // 1. Open the side panel immediately, while Chrome still treats this as a user gesture.
  const opening = chrome.sidePanel.open({ windowId: tab.windowId }).then(
    () => ({ ok: true }),
    (e) => ({ ok: false, error: e.message }),
  );

  // 2. Write from the hidden offscreen page (the panel was closed when the hotkey was pressed).
  const writing = ensureOffscreen()
    .then(() => chrome.runtime.sendMessage({ type: 'write-from-offscreen' }))
    .catch((e) => ({ ok: false, error: e.message }));

  writing.then((r) => log({ path: 'hotkey, write from background', ...r }));
  opening.then((r) => log({ path: 'hotkey opened side panel', ...r }));
});
