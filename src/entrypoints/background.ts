/**
 * Background: owns the hotkey, starts the picker, takes the screenshot.
 *
 * Learned from the folder test (2026-10-31):
 * - sidePanel.open() must be called first, before any await, or Chrome stops treating the hotkey as a user gesture.
 * - A hidden offscreen page must stay open, or Chrome drops folder access whenever the side panel closes.
 */
export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  let creating: Promise<void> | null = null;
  async function keepAlivePage() {
    if (await chrome.offscreen.hasDocument()) return;
    creating ??= chrome.offscreen
      .createDocument({
        url: 'keepalive.html',
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Keeps access to the linked project folder while the side panel is closed',
      })
      .finally(() => (creating = null));
    await creating;
  }
  chrome.runtime.onStartup.addListener(keepAlivePage);
  chrome.runtime.onInstalled.addListener(keepAlivePage);

  async function startPicker(tabId: number) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/picker.js'] });
  }

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'start-capture' || !tab?.id || !tab.windowId) return;
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {}); // first, no await before it
    keepAlivePage().catch(() => {});
    startPicker(tab.id).then(
      () => chrome.runtime.sendMessage({ type: 'picking' }).catch(() => {}),
      (e) => chrome.runtime.sendMessage({ type: 'picker-failed', error: String(e?.message ?? e) }).catch(() => {}),
    );
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'keepalive') {
      keepAlivePage().then(() => reply(true), () => reply(false));
      return true;
    }
    if (msg.type === 'start-picker-from-panel') {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
        try {
          if (!tab?.id) throw new Error('No active tab');
          await startPicker(tab.id);
          reply({ ok: true });
        } catch (e) {
          reply({ ok: false, error: String((e as Error).message ?? e) });
        }
      });
      return true;
    }
    if (msg.type === 'element-picked' && sender.tab?.windowId) {
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(
        (screenshot) => chrome.runtime.sendMessage({ ...msg, type: 'capture-ready', screenshot }).catch(() => {}),
        (e) => chrome.runtime.sendMessage({ ...msg, type: 'capture-ready', screenshotError: String(e?.message ?? e) }).catch(() => {}),
      );
    }
  });
});
