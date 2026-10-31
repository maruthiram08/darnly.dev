// Background for the folder write test.
// Clicking the toolbar icon opens the side panel.
// The hotkey (Alt+Shift+B) tests writing when the panel is open AND when it is closed.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function log(entry) {
  const { results = [] } = await chrome.storage.local.get('results');
  results.unshift({ at: new Date().toISOString(), ...entry });
  await chrome.storage.local.set({ results: results.slice(0, 50) });
}

async function askPanel() {
  try {
    return await chrome.runtime.sendMessage({ type: 'write-from-panel' });
  } catch {
    return null; // panel not open
  }
}

async function writeViaOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Write capture files to the linked project folder',
    });
  }
  return chrome.runtime.sendMessage({ type: 'write-from-offscreen' });
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'write-test-capture') return;

  const panelResult = await askPanel();
  if (panelResult) {
    await log({ path: 'hotkey, panel open', ...panelResult });
    return;
  }

  // Panel closed: try writing with no visible page first.
  let offscreenResult;
  try {
    offscreenResult = await writeViaOffscreen();
  } catch (e) {
    offscreenResult = { ok: false, error: e.message };
  }
  await log({ path: 'hotkey, panel closed (offscreen)', ...offscreenResult });

  // Also check whether the hotkey may open the side panel (the fallback plan).
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    await log({ path: 'hotkey opened side panel', ok: true });
  } catch (e) {
    await log({ path: 'hotkey opened side panel', ok: false, error: e.message });
  }
});
