import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCT, INBOX_FOLDER } from '@/config/product';
import type { ElementInfo } from '@/lib/element-info';
import { captureId } from '@/lib/capture-name';
import { captureMarkdown, headingFrom } from '@/lib/capture-markdown';
import { markScreenshot } from '@/lib/screenshot';
import { mergeLogs, type LogEntry } from '@/lib/logs';
import { ensureAccess, folderAccess, listCaptures, loadFolder, readProjectFile, saveFolder, writeProjectFile, writeToProject, type CaptureSummary } from '@/lib/project-folder';
import { planSetup, type PlannedChange } from '@/lib/agent-setup';


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
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [plan, setPlan] = useState<PlannedChange[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  // Chrome leaves the shortcut empty when another extension already uses the same keys.
  const [shortcut, setShortcut] = useState<string | null>('⌥⇧B');
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

  const refreshProject = useCallback(async (f: FileSystemDirectoryHandle | null) => {
    if (!f || (await folderAccess(f)) !== 'granted') return;
    setCaptures(await listCaptures(f));
    const paths = ['AGENTS.md', 'CLAUDE.md', '.gitignore', `.agents/skills/${PRODUCT.SLUG}/SKILL.md`, `.claude/skills/${PRODUCT.SLUG}/SKILL.md`];
    const existing = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await readProjectFile(f, p)] as const)));
    const next = planSetup(existing);
    setPlan(next);
    setSetupNeeded(next.length > 0);
  }, []);

  const refreshFolder = useCallback(async () => {
    const f = await loadFolder();
    setFolder(f);
    setAccess(await folderAccess(f));
    await refreshProject(f);
  }, [refreshProject]);

  const applySetup = async () => {
    if (!folder || !plan) return;
    if (!(await ensureAccess(folder))) return setMessage('Darnly needs "Allow" to set up your project.');
    for (const c of plan) await writeProjectFile(folder, c.path, c.content);
    setShowPlan(false);
    setMessage(`Project set up. Your agent now knows to look in ${INBOX_FOLDER}/.`);
    await refreshProject(folder);
  };

  useEffect(() => {
    document.title = PRODUCT.NAME;
    chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {});
    refreshFolder();
    refreshSite();
    const checkShortcut = () =>
      chrome.commands.getAll().then((all) => setShortcut(all.find((c) => c.name === 'start-capture')?.shortcut || null));
    checkShortcut();
    addEventListener('focus', checkShortcut);
    const poll = setInterval(() => loadFolder().then(refreshProject), 5000);
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
      clearInterval(poll);
      removeEventListener('focus', checkShortcut);
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onTab);
    };
  }, [refreshFolder, refreshSite, refreshProject]);

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
    else setMessage(`Press ${shortcut ?? 'the Darnly shortcut'} on the page instead. This button only works on localhost.`);
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
      refreshProject(folder);
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
          {shortcut ? (
            <p className="text-gray-600">Press <Kbd>{shortcut}</Kbd> on any page, then click the broken part.</p>
          ) : (
            <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
              <p>The keyboard shortcut isn't set, usually because another extension uses the same keys.</p>
              <button className="mt-2 w-full rounded-lg border border-amber-300 bg-white py-1.5" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                Set a shortcut
              </button>
            </div>
          )}
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

      {folder && access === 'granted' && setupNeeded && plan && (
        <section className="rounded-lg border border-gray-200 p-3">
          <p className="font-medium">Set up this project</p>
          <p className="mt-1 text-gray-600">Adds a short note so Claude Code, Codex and Cursor know where your bug reports are.</p>
          {!showPlan ? (
            <button className="mt-2 w-full rounded-lg border border-gray-300 py-1.5" onClick={() => setShowPlan(true)}>See what it adds</button>
          ) : (
            <div className="mt-2 space-y-2">
              {plan.map((c) => (
                <details key={c.path} className="rounded border border-gray-200 p-2">
                  <summary className="cursor-pointer text-xs"><strong>{c.action === 'create' ? 'Create' : 'Update'}</strong> <code>{c.path}</code></summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-gray-700">{c.content}</pre>
                </details>
              ))}
              <div className="flex gap-2">
                <button className="flex-1 rounded-lg bg-gray-900 py-1.5 text-white" onClick={applySetup}>Add these</button>
                <button className="rounded-lg px-3 text-gray-500" onClick={() => setShowPlan(false)}>Not now</button>
              </div>
            </div>
          )}
        </section>
      )}

      {captures.length > 0 && (
        <section>
          <p className="font-medium">
            Captured bugs <span className="font-normal text-gray-500">· {captures.filter((c) => c.status === 'waiting').length} waiting, {captures.filter((c) => c.status === 'fixed').length} fixed</span>
          </p>
          <ul className="mt-2 divide-y divide-gray-100">
            {captures.slice(0, 20).map((c) => (
              <li key={c.status + c.id} className="flex items-center gap-2 py-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === 'fixed' ? 'bg-emerald-500' : 'bg-amber-400'}`} title={c.status === 'fixed' ? 'Fixed (moved to done)' : 'Waiting for your agent'} />
                <span className={`truncate ${c.status === 'fixed' ? 'text-gray-400 line-through' : ''}`} title={c.title}>{c.title}</span>
              </li>
            ))}
          </ul>
          {captures.some((c) => c.status === 'waiting') && (
            <p className="mt-2 text-xs text-gray-500">Tell your agent: <em>"fix the bugs in {INBOX_FOLDER}"</em></p>
          )}
        </section>
      )}
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
