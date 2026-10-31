import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCT, INBOX_FOLDER } from '@/config/product';
import type { ElementInfo } from '@/lib/element-info';
import { captureId } from '@/lib/capture-name';
import { captureMarkdown, headingFrom } from '@/lib/capture-markdown';
import { markScreenshot } from '@/lib/screenshot';
import { mergeLogs, type LogEntry } from '@/lib/logs';
import { ensureAccess, folderAccess, loadFolder, saveFolder, writeToProject } from '@/lib/project-folder';

interface PendingCapture {
  element?: ElementInfo;
  page: { url: string; title: string; viewport: { width: number; height: number } };
  screenshot?: string;
  screenshotError?: string;
  logs: LogEntry[];
  recorder: boolean;
}

interface SiteStatus {
  recordable: boolean;
  on?: boolean;
  origin?: string;
  builtIn?: boolean;
}

type Stage = 'idle' | 'picking' | 'note' | 'saved';

export function App() {
  const [stage, setStage] = useState<Stage>('idle');
  const [capture, setCapture] = useState<PendingCapture | null>(null);
  const [note, setNote] = useState('');
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [access, setAccess] = useState<string>('none');
  const [message, setMessage] = useState('');
  const [lastMarkdown, setLastMarkdown] = useState('');
  const [lastFile, setLastFile] = useState('');
  const [site, setSite] = useState<SiteStatus>({ recordable: false });
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const refreshSite = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) setSite(await chrome.runtime.sendMessage({ type: 'recording-status', url: tab.url }));
  }, []);

  const recordThisSite = async () => {
    if (!site.origin) return;
    // Chrome shows its own "allow on this site" prompt here.
    const ok = await chrome.permissions.request({ origins: [`${site.origin}/*`] });
    if (!ok) return;
    await chrome.runtime.sendMessage({ type: 'record-site', origin: site.origin });
    await refreshSite();
    setMessage('Recording is on. Reload the page once so Darnly can start listening.');
  };

  const refreshFolder = useCallback(async () => {
    const f = await loadFolder();
    setFolder(f);
    setAccess(await folderAccess(f));
  }, []);

  useEffect(() => {
    document.title = PRODUCT.NAME;
    chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {});
    refreshFolder();
    refreshSite();
    const onTab = () => refreshSite();
    chrome.tabs.onActivated.addListener(onTab);
    chrome.tabs.onUpdated.addListener(onTab);
    type Incoming = { type?: string; error?: string; element?: ElementInfo; page?: PendingCapture['page']; screenshot?: string; screenshotError?: string; pageLogs?: LogEntry[]; browserLogs?: LogEntry[]; recorder?: boolean };
    const listener = (msg: Incoming) => {
      if (msg.type === 'picking') {
        setStage('picking');
        setMessage('');
      } else if (msg.type === 'picker-failed') {
        setStage('idle');
        setMessage(`Couldn't start on this page: ${msg.error}. Chrome pages and the Web Store can't be captured.`);
      } else if (msg.type === 'capture-ready') {
        setCapture({
          element: msg.element,
          page: msg.page!,
          screenshot: msg.screenshot,
          screenshotError: msg.screenshotError,
          logs: mergeLogs(msg.pageLogs ?? [], msg.browserLogs ?? []),
          recorder: !!msg.recorder,
        });
        if (msg.page?.url) chrome.runtime.sendMessage({ type: 'recording-status', url: msg.page.url }).then(setSite, () => {});
        setNote('');
        setStage('note');
        setTimeout(() => noteRef.current?.focus(), 50);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onTab);
    };
  }, [refreshFolder, refreshSite]);

  const linkFolder = async () => {
    try {
      const handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ id: 'project', mode: 'readwrite' });
      await saveFolder(handle);
      await refreshFolder();
      setMessage('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessage(`Couldn't link that folder: ${(e as Error).message}`);
    }
  };

  const startFromPanel = async () => {
    const r = await chrome.runtime.sendMessage({ type: 'start-picker-from-panel' });
    if (r?.ok) setStage('picking');
    else setMessage('Press Option+Shift+B on the page instead. This button only works on localhost.');
  };

  const build = (c: PendingCapture) => {
    const when = new Date();
    const id = captureId(when, headingFrom(note, c.element));
    const markdown = captureMarkdown({
      id,
      note,
      url: c.page.url,
      title: c.page.title,
      viewport: c.page.viewport,
      browser: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'Chrome',
      capturedAt: when,
      element: c.element,
      logs: c.logs,
      recorder: c.recorder,
    });
    return { id, markdown };
  };

  const save = async () => {
    if (!capture) return;
    if (!folder) {
      setMessage('Link your project folder first, then press Save again.');
      return;
    }
    // This runs inside the Enter key press, so Chrome may show its once-a-session "Allow" prompt here.
    if (!(await ensureAccess(folder))) {
      setMessage('Darnly needs "Allow" to save into your project. Press Save again and choose Allow.');
      return;
    }
    const { id, markdown } = build(capture);
    const files: Record<string, Blob | string> = { [`${id}.md`]: markdown };
    if (capture.logs.length) files[`${id}.logs.json`] = JSON.stringify({ url: capture.page.url, entries: capture.logs }, null, 2);
    if (capture.screenshot) {
      files[`${id}.png`] = await markScreenshot(capture.screenshot, capture.page.viewport.width, capture.element?.rect);
    }
    try {
      await writeToProject(folder, 'inbox', files);
      setAccess('granted');
      setLastMarkdown(markdown);
      setLastFile(`${INBOX_FOLDER}/${id}.md`);
      setStage('saved');
      setCapture(null);
      setMessage('');
    } catch (e) {
      setMessage(`Couldn't save: ${(e as Error).message}`);
    }
  };

  const copyPrompt = async (markdown: string) => {
    await navigator.clipboard.writeText(markdown);
    setMessage('Copied. Paste it into your agent.');
  };

  return (
    <main className="space-y-4 p-4 text-sm text-gray-900">
      <header>
        <h1 className="text-base font-semibold">{PRODUCT.NAME}</h1>
        <FolderLine folder={folder} access={access} onLink={linkFolder} />
      </header>

      {site.recordable && !site.builtIn && !site.on && (
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-gray-600">Errors and failed requests aren't recorded on <strong>{site.origin?.replace(/^https?:\/\//, '')}</strong>.</p>
          <button className="mt-2 w-full rounded-lg border border-gray-300 py-1.5" onClick={recordThisSite}>Record errors on this site</button>
        </div>
      )}

      {stage === 'idle' && (
        <section className="space-y-2">
          <p className="text-gray-600">Press <Kbd>Option</Kbd>+<Kbd>Shift</Kbd>+<Kbd>B</Kbd> on any page, then click the broken part.</p>
          <button className="w-full rounded-lg border border-gray-300 py-2" onClick={startFromPanel}>Capture a bug</button>
        </section>
      )}

      {stage === 'picking' && <p className="rounded-lg bg-rose-50 p-3 text-rose-800">Click the broken part of the page. Press Esc to capture the whole page.</p>}

      {stage === 'note' && capture && (
        <section className="space-y-3">
          {capture.screenshot && <MarkedPreview capture={capture} />}
          {capture.screenshotError && <p className="text-amber-700">No screenshot: {capture.screenshotError}</p>}
          {capture.element && (
            <p className="truncate text-xs text-gray-500" title={capture.element.selector}>
              {capture.element.tag}{capture.element.text ? ` "${capture.element.text.slice(0, 50)}"` : ''}
            </p>
          )}
          <p className="text-xs text-gray-500">
            {capture.recorder
              ? `${capture.logs.filter((l) => l.kind !== 'request').length} errors · ${capture.logs.filter((l) => l.kind === 'request').length} failed requests (last 60s), secrets hidden`
              : 'Errors not recorded on this site'}
          </p>
          <label className="block font-medium" htmlFor="note">What did you expect?</label>
          <textarea
            id="note"
            ref={noteRef}
            className="w-full rounded-lg border border-gray-300 p-2"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                save();
              }
            }}
            placeholder="Clicking Pay now should open the payment form"
          />
          <div className="flex gap-2">
            <button className="flex-1 rounded-lg bg-gray-900 py-2 text-white" onClick={save}>Save (Enter)</button>
            <button className="rounded-lg border border-gray-300 px-3" onClick={() => copyPrompt(build(capture).markdown)}>Copy as prompt</button>
            <button className="rounded-lg px-3 text-gray-500" onClick={() => { setStage('idle'); setCapture(null); }}>Cancel</button>
          </div>
          <p className="text-xs text-gray-500">Shift+Enter for a new line.</p>
        </section>
      )}

      {stage === 'saved' && (
        <section className="space-y-2">
          <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Saved to <code>{lastFile}</code></p>
          <p className="text-gray-600">Tell your agent: <em>"fix the bugs in {INBOX_FOLDER}"</em></p>
          <div className="flex gap-2">
            <button className="flex-1 rounded-lg border border-gray-300 py-2" onClick={startFromPanel}>Capture another</button>
            <button className="rounded-lg border border-gray-300 px-3" onClick={() => copyPrompt(lastMarkdown)}>Copy as prompt</button>
          </div>
        </section>
      )}

      {message && <p className="text-amber-700">{message}</p>}
    </main>
  );
}

function FolderLine({ folder, access, onLink }: { folder: FileSystemDirectoryHandle | null; access: string; onLink: () => void }) {
  if (!folder) {
    return (
      <button className="mt-2 w-full rounded-lg bg-gray-900 py-2 text-white" onClick={onLink}>
        Link your project folder
      </button>
    );
  }
  return (
    <p className="mt-1 text-xs text-gray-500">
      Saving to <strong>{folder.name}</strong>
      {access !== 'granted' && ' (Chrome will ask to allow on your next save)'} ·{' '}
      <button className="underline" onClick={onLink}>change</button>
    </p>
  );
}

function MarkedPreview({ capture }: { capture: PendingCapture }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let revoked = '';
    markScreenshot(capture.screenshot!, capture.page.viewport.width, capture.element?.rect).then((b) => {
      revoked = URL.createObjectURL(b);
      setUrl(revoked);
    });
    return () => URL.revokeObjectURL(revoked);
  }, [capture]);
  return url ? <img src={url} alt="Screenshot with the picked element outlined" className="w-full rounded-lg border border-gray-200" /> : null;
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-gray-300 bg-gray-50 px-1 text-xs">{children}</kbd>;
}
