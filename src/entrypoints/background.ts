/**
 * Background: owns the hotkey, starts the picker, takes the screenshot.
 *
 * Learned from the folder test (2026-10-31):
 * - sidePanel.open() must be called first, before any await, or Chrome stops treating the hotkey as a user gesture.
 * - A hidden offscreen page must stay open, or Chrome drops folder access whenever the side panel closes.
 */
import { redactLog, type LogEntry } from '@/lib/logs';

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

  // Failures only the browser sees (blocked images, CORS, DNS). Kept per tab for 60 seconds in session storage.
  const key = (tabId: number) => `net:${tabId}`;
  // Writes go one at a time: two failures arriving together would otherwise overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  function remember(tabId: number, entry: LogEntry) {
    if (tabId < 0) return;
    const k = key(tabId);
    queue = queue.then(async () => {
      const cutoff = Date.now() - 60_000;
      const list = ((await chrome.storage.session.get(k))[k] as LogEntry[] | undefined) ?? [];
      await chrome.storage.session.set({ [k]: [...list.filter((e) => e.t >= cutoff), entry].slice(-100) });
    }).catch(() => {});
  }
  const filter = { urls: ['<all_urls>'] };
  chrome.webRequest.onCompleted.addListener((d) => {
    if (d.statusCode >= 400 && d.type !== 'main_frame') {
      remember(d.tabId, { t: Date.now(), kind: 'request', method: d.method, url: d.url, status: d.statusCode, resourceType: d.type });
    }
  }, filter);
  chrome.webRequest.onErrorOccurred.addListener((d) => {
    if (d.type !== 'main_frame' && d.error !== 'net::ERR_ABORTED') {
      remember(d.tabId, { t: Date.now(), kind: 'request', method: d.method, url: d.url, status: 0, message: d.error, resourceType: d.type });
    }
  }, filter);
  chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));

  async function startPicker(tabId: number) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/picker.js'] });
  }

  /** Production sites: the recorder runs only where the user switched it on (Chrome asks to confirm). */
  async function recordSite(origin: string) {
    const id = `recorder:${origin}`;
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (!existing.length) {
      await chrome.scripting.registerContentScripts([
        { id, matches: [`${origin}/*`], js: ['content-scripts/recorder.js'], world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true },
      ]);
    }
    return { ok: true };
  }

  async function recordingStatus(url: string) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return { recordable: false };
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return { recordable: true, on: true, origin: u.origin, builtIn: true };
      const ids = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
      const granted = await chrome.permissions.contains({ origins: [`${u.origin}/*`] });
      return { recordable: true, on: granted && ids.includes(`recorder:${u.origin}`), origin: u.origin };
    } catch {
      return { recordable: false };
    }
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
    if (msg.type === 'recording-status') {
      recordingStatus(msg.url).then(reply);
      return true;
    }
    if (msg.type === 'record-site') {
      recordSite(msg.origin).then(reply, (e) => reply({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }
    if (msg.type === 'element-picked' && sender.tab?.windowId && sender.tab.id != null) {
      const k = key(sender.tab.id);
      const browserLogs = queue.then(() => chrome.storage.session.get(k)).then((r) => ((r[k] as LogEntry[] | undefined) ?? []).map(redactLog));
      const shot = chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      // Tell the picker the screenshot is taken, so it can unmask password and card fields.
      shot.finally(() => reply(true)).catch(() => {});
      Promise.all([shot, browserLogs]).then(
        ([screenshot, browser]) => chrome.runtime.sendMessage({ ...msg, type: 'capture-ready', screenshot, browserLogs: browser }).catch(() => {}),
        (e: Error) => browserLogs.then((browser) =>
          chrome.runtime.sendMessage({ ...msg, type: 'capture-ready', browserLogs: browser, screenshotError: String(e?.message ?? e) }).catch(() => {}),
        ),
      );
      return true;
    }
  });
});
