/**
 * Background: owns the hotkey, starts the picker, takes the screenshot.
 *
 * Learned from the folder test (2026-10-31):
 * - sidePanel.open() must be called first, before any await, or Chrome stops treating the hotkey as a user gesture.
 * - A hidden offscreen page must stay open, or Chrome drops folder access whenever the side panel closes.
 */
import { redactLog, type LogEntry } from '@/lib/logs';
import { addStep, cleanStep, MAX_RECORDED_STEPS, type Step } from '@/lib/steps';
import { whatsNewUrl } from '@/lib/whats-new';

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
  // Users never see Chrome's silent updates, so after one, open the release notes once at the new version.
  chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    const url = whatsNewUrl(reason, previousVersion, chrome.runtime.getManifest().version);
    if (url) chrome.tabs.create({ url }).catch(() => {});
  });

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
  chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([key(tabId), recKey(tabId)]));

  // "Record steps": the list lives here (per tab, in session storage) so it survives page loads.
  const recKey = (tabId: number) => `rec:${tabId}`;
  type Recording = { startedAt: number; steps: Step[] };
  let recQueue: Promise<unknown> = Promise.resolve();
  async function recording(tabId: number): Promise<Recording | undefined> {
    return (await chrome.storage.session.get(recKey(tabId)))[recKey(tabId)] as Recording | undefined;
  }
  function tellPanel(tabId: number, count: number | null) {
    chrome.runtime.sendMessage({ type: 'steps-updated', tabId, count }).catch(() => {});
  }
  async function injectSteps(tabId: number) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/steps.js'] });
  }
  async function startRecording(tabId: number) {
    await chrome.storage.session.set({ [recKey(tabId)]: { startedAt: Date.now(), steps: [] } satisfies Recording });
    try {
      await injectSteps(tabId);
    } catch (e) {
      await chrome.storage.session.remove(recKey(tabId));
      throw e;
    }
    tellPanel(tabId, 0);
  }
  async function stopRecording(tabId: number) {
    await chrome.storage.session.remove(recKey(tabId));
    chrome.tabs.sendMessage(tabId, { type: 'steps-stop' }).catch(() => {});
    tellPanel(tabId, null);
  }

  /** A small picture of the screen after a step: 640 px wide JPEG, so 40 steps stay well under a megabyte or two. */
  let lastShot = 0;
  async function stepShot(windowId: number, arrived: number): Promise<string | undefined> {
    // Stay under Chrome's limit of two screenshots a second.
    const wait = Math.max(0, lastShot + 550 - Date.now());
    // Steps came faster than screenshots can be taken: a late picture would show a later step, so skip it.
    if (Date.now() + wait - arrived > 700) return undefined;
    await new Promise((r) => setTimeout(r, wait));
    lastShot = Date.now();
    try {
      const png = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
      const img = await createImageBitmap(await (await fetch(png)).blob());
      const k = Math.min(1, 640 / img.width);
      const canvas = new OffscreenCanvas(Math.round(img.width * k), Math.round(img.height * k));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:image/jpeg;base64,${btoa(bin)}`;
    } catch {
      return undefined; // a page Chrome won't capture, or the tab isn't visible: the step is still listed
    }
  }

  async function onStep(tab: chrome.tabs.Tab, raw: unknown, noShot: boolean): Promise<boolean> {
    const tabId = tab.id!;
    const arrived = Date.now();
    if (!(await recording(tabId))) return false;
    const step = cleanStep(raw);
    if (!step) return true;
    // One step at a time, in the order they happened, each with its screenshot.
    recQueue = recQueue.then(async () => {
      const shot = !noShot && tab.active && tab.windowId != null ? await stepShot(tab.windowId, arrived) : undefined;
      const rec = await recording(tabId);
      if (!rec) return;
      const steps = addStep(rec.steps, { ...step, ...(shot && { shot }) }, MAX_RECORDED_STEPS);
      await chrome.storage.session.set({ [recKey(tabId)]: { ...rec, steps } });
      tellPanel(tabId, steps.length);
    }).catch(() => {});
    return true;
  }

  // A new page load in a recording tab: keep recording there.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    recording(tabId).then((rec) => rec && injectSteps(tabId)).catch(() => {});
  });

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
    // When the shortcut was pressed, so the panel can time each capture (shortcut to saved).
    chrome.storage.session.set({ pressedAt: Date.now() }).catch(() => {});
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
      chrome.storage.session.set({ pressedAt: Date.now() }).catch(() => {});
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
    if (msg.type === 'step' && sender.tab?.id != null) {
      onStep(sender.tab, msg.step, msg.noShot === true).then((on) => reply({ recording: on }), () => reply({ recording: true }));
      return true;
    }
    if (msg.type === 'steps-start' || msg.type === 'steps-stop' || msg.type === 'steps-status') {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
        try {
          if (!tab?.id) throw new Error('No active tab');
          if (msg.type === 'steps-start') await startRecording(tab.id);
          if (msg.type === 'steps-stop') await stopRecording(tab.id);
          const rec = await recording(tab.id);
          reply({ ok: true, tabId: tab.id, count: rec ? rec.steps.length : null });
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
      // Steps the user recorded on this tab go with this capture, and the recording ends.
      const tabId = sender.tab.id;
      const recorded = recQueue.then(() => recording(tabId)).then(async (rec) => {
        if (!rec) return undefined;
        await stopRecording(tabId);
        return rec.steps;
      }).catch(() => undefined);
      // After any step screenshots still being taken, and not too soon after them (Chrome allows two a second).
      const windowId = sender.tab.windowId;
      const shot = recQueue
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, lastShot + 550 - Date.now()))))
        .then(() => chrome.tabs.captureVisibleTab(windowId, { format: 'png' }));
      // Tell the picker the screenshot is taken, so it can unmask password and card fields.
      shot.finally(() => reply(true)).catch(() => {});
      Promise.all([shot, browserLogs, recorded]).then(
        ([screenshot, browser, recordedSteps]) => chrome.runtime.sendMessage({ ...msg, type: 'capture-ready', screenshot, browserLogs: browser, recordedSteps }).catch(() => {}),
        (e: Error) => Promise.all([browserLogs, recorded]).then(([browser, recordedSteps]) =>
          chrome.runtime.sendMessage({ ...msg, type: 'capture-ready', browserLogs: browser, recordedSteps, screenshotError: String(e?.message ?? e) }).catch(() => {}),
        ),
      );
      return true;
    }
  });
});
