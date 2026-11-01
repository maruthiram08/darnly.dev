import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCT, INBOX_FOLDER } from '@/config/product';
import type { ElementInfo } from '@/lib/element-info';
import { captureId } from '@/lib/capture-name';
import { captureMarkdown, headingFrom } from '@/lib/capture-markdown';
import { markScreenshot } from '@/lib/screenshot';
import { mergeLogs, type LogEntry } from '@/lib/logs';
import { ensureAccess, folderAccess, listCaptures, loadFolder, readProjectFile, saveFolder, writeProjectFile, writeToProject, type CaptureSummary } from '@/lib/project-folder';
import { planSetup, type PlannedChange } from '@/lib/agent-setup';
import { CloudError, deleteAllCloudBugs, listCloudBugs, loadSession, mcpUrl, signInWithGoogle, signOut, uploadBug, type CloudBug, type CloudSession } from '@/lib/cloud-inbox';


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
  // The same report worded for pasting into a chat (no file paths a cloud agent can't open).
  const [lastPaste, setLastPaste] = useState('');
  const [lastTitle, setLastTitle] = useState('');
  const [lastFile, setLastFile] = useState('');
  // The saved bug as real files, so it can be dragged straight into an agent's chat (cloud projects have no local folder).
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const [site, setSite] = useState<SiteStatus>({ recordable: false });
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  // Bugs the agent fixed since the panel last looked, for the "take a look" nudge.
  const [justFixed, setJustFixed] = useState<CaptureSummary[]>([]);
  const seenStatus = useRef<Map<string, string> | null>(null);
  // Capture times (shortcut to saved), kept on this computer, for the MVP success check.
  const [stats, setStats] = useState<{ ms: number }[]>([]);
  useEffect(() => {
    chrome.storage.local.get('captureTimes').then((r) => setStats(Array.isArray(r.captureTimes) ? r.captureTimes : []), () => {});
  }, []);
  const [plan, setPlan] = useState<PlannedChange[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  // Chrome leaves the shortcut empty when another extension already uses the same keys.
  const [shortcut, setShortcut] = useState<string | null>('⌥⇧B');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // First run: is the code on this computer (link a folder) or in the cloud (copy bugs into the agent)?
  const [cloud, setCloud] = useState<boolean | null>(null);
  useEffect(() => {
    chrome.storage.local.get('cloudProject').then((r) => setCloud(r.cloudProject === true ? true : false), () => setCloud(false));
  }, []);
  // Cloud inbox: signed in, bugs upload to Darnly cloud and the agent reads them through MCP.
  const [session, setSession] = useState<CloudSession | null>(null);
  const [cloudBugs, setCloudBugs] = useState<CaptureSummary[]>([]);
  const [mcp, setMcp] = useState('');
  const [sentToCloud, setSentToCloud] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cloudSeen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    loadSession().then(setSession, () => {});
    mcpUrl().then(setMcp, () => {});
  }, []);
  const refreshCloud = useCallback(async (s: CloudSession | null) => {
    if (!s) return;
    try {
      const list = (await listCloudBugs(s)).map(toSummary);
      const before = cloudSeen.current;
      if (before) {
        const fixedNow = list.filter((c) => c.status === 'fixed' && before.get(c.id) === 'waiting');
        if (fixedNow.length) setJustFixed((prev) => [...fixedNow, ...prev.filter((p) => !fixedNow.some((n) => n.id === p.id))]);
      }
      cloudSeen.current = new Map(list.map((c) => [c.id, c.status]));
      setCloudBugs(list);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) setSession(null);
    }
  }, []);
  useEffect(() => {
    if (!session) return;
    refreshCloud(session);
    const t = setInterval(() => refreshCloud(session), 8000);
    return () => clearInterval(t);
  }, [session, refreshCloud]);
  const cloudSignIn = async () => {
    setMessage('');
    try {
      setSession(await signInWithGoogle());
      chooseCloud(true);
    } catch (e) {
      const why = (e as Error).message;
      setMessage(
        /oauth2|client/i.test(why)
          ? "Cloud sign-in isn't switched on in this build yet. Copy each bug into your agent for now."
          : `Couldn't sign in: ${why}`,
      );
    }
  };
  const cloudSignOut = async () => {
    if (session) await signOut(session);
    setSession(null);
    setCloudBugs([]);
    cloudSeen.current = null;
  };
  const cloudDeleteAll = async () => {
    if (!session) return;
    try {
      const n = await deleteAllCloudBugs(session);
      setMessage(`Deleted ${n} ${n === 1 ? 'bug' : 'bugs'} from your Darnly inbox.`);
      setCloudBugs([]);
      cloudSeen.current = new Map();
    } catch (e) {
      setMessage(`Couldn't delete: ${(e as Error).message}`);
    }
    setConfirmDelete(false);
  };

  const chooseCloud = (v: boolean) => {
    setCloud(v);
    chrome.storage.local.set({ cloudProject: v }).catch(() => {});
  };

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
    const list = await listCaptures(f);
    const before = seenStatus.current;
    if (before) {
      const fixedNow = list.filter((c) => c.status === 'fixed' && before.get(c.id) === 'waiting');
      if (fixedNow.length) setJustFixed((prev) => [...fixedNow, ...prev.filter((p) => !fixedNow.some((n) => n.id === p.id))]);
    }
    seenStatus.current = new Map(list.map((c) => [c.id, c.status]));
    setCaptures(list);
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
      } else if (msg.type === 'picker-cancelled') {
        setStage((s) => (s === 'picking' ? 'idle' : s));
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
      chooseCloud(false);
      await refreshFolder();
      setMessage('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessage(`Couldn't link that folder: ${(e as Error).message}`);
    }
  };

  const pickerCommand = async (action: 'cancel' | 'whole') => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'picker-command', action }).catch(() => {});
    if (action === 'cancel') setStage('idle'); // even if the page already lost the picker
  };

  const startFromPanel = async () => {
    const r = await chrome.runtime.sendMessage({ type: 'start-picker-from-panel' });
    if (r?.ok) setStage('picking');
    else setMessage(`Press ${shortcut ?? 'the Darnly shortcut'} on the page instead. This button only works on localhost.`);
  };

  const build = (c: PendingCapture) => {
    const when = new Date();
    const id = captureId(when, headingFrom(note, c.element));
    const input = {
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
    };
    return {
      id,
      markdown: captureMarkdown(input),
      paste: captureMarkdown({ ...input, forPaste: true }),
      cloud: captureMarkdown({ ...input, forCloud: true }),
    };
  };

  const save = async () => {
    if (!capture) return;
    const { id, markdown, paste, cloud: cloudReport } = build(capture);
    const files: Record<string, Blob | string> = { [`${id}.md`]: markdown };
    if (capture.logs.length) files[`${id}.logs.json`] = JSON.stringify({ url: capture.page.url, entries: capture.logs }, null, 2);
    if (capture.screenshot) {
      const el = capture.element;
      const target = el?.atCursor ?? el;
      const caption = [
        `Expected: ${note.trim() || '(no note)'}`,
        `Page: ${capture.page.url}${target ? `   Element: ${target.selector}${target.text ? ` "${target.text.slice(0, 60)}"` : ''}` : ''}`,
      ];
      files[`${id}.png`] = await markScreenshot(capture.screenshot, capture.page.viewport.width, el?.rect, el?.atCursor && el.point, caption);
    }
    const asFiles = Object.entries(files)
      .filter(([name]) => !name.endsWith('.logs.json')) // the markdown already lists the errors; keep the drop to two files
      .map(([name, body]) => new File([body], name, { type: name.endsWith('.png') ? 'image/png' : 'text/markdown' }));
    const recordTime = async () => {
      const { pressedAt } = await chrome.storage.session.get('pressedAt').catch(() => ({ pressedAt: undefined }));
      if (typeof pressedAt !== 'number') return;
      const ms = Date.now() - pressedAt;
      if (ms <= 0 || ms > 10 * 60_000) return; // ignore captures left open for ages
      const next = [...stats, { ms, at: Date.now() }].slice(-500);
      setStats(next);
      chrome.storage.local.set({ captureTimes: next }).catch(() => {});
      chrome.storage.session.remove('pressedAt').catch(() => {});
    };
    const done = (file: string, cloudSent = false) => {
      recordTime();
      setSentToCloud(cloudSent);
      setLastMarkdown(markdown);
      setLastPaste(paste);
      setLastTitle(headingFrom(note, capture.element));
      setLastFiles(asFiles);
      setLastFile(file);
      setStage('saved');
      setCapture(null);
      setMessage('');
    };
    // Cloud project, signed in: send it to the Darnly inbox, where the agent reads it through MCP.
    if (!folder && session) {
      try {
        await uploadBug(session, {
          title: headingFrom(note, capture.element),
          pageUrl: capture.page.url,
          report: cloudReport,
          picture: files[`${id}.png`] as Blob | undefined,
          logs: files[`${id}.logs.json`] as string | undefined,
        });
        done('', true);
        refreshCloud(session);
      } catch (e) {
        done('');
        setMessage(`Couldn't send it to your Darnly inbox (${(e as Error).message}). Copy it into your agent below instead.`);
      }
      return;
    }
    // No linked folder and not signed in: keep the bug in the panel, ready to copy into the agent.
    if (!folder) return done('');
    // This runs inside the Enter key press, so Chrome may show its once-a-session "Allow" prompt here.
    if (!(await ensureAccess(folder))) {
      setMessage('Darnly needs "Allow" to save into your project. Press Save again and choose Allow.');
      return;
    }
    try {
      await writeToProject(folder, 'inbox', files);
      setAccess('granted');
      done(`${INBOX_FOLDER}/${id}.md`);
      refreshProject(folder);
    } catch (e) {
      setMessage(`Couldn't save: ${(e as Error).message}`);
    }
  };

  // Claude's desktop app keeps only the text when the clipboard holds both, so picture and details are copied separately.
  // Both buttons stay, so either can be copied again.
  const [copied, setCopied] = useState<{ picture?: boolean; details?: boolean }>({});
  useEffect(() => setCopied({}), [lastMarkdown]);
  const copyPicture = async (files: File[]) => {
    const png = files.find((f) => f.type === 'image/png');
    if (!png) return;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    setCopied((c) => ({ ...c, picture: true }));
    setMessage('Picture copied. Paste it into your agent (Cmd+V), then copy the details.');
  };
  const copyDetails = async (markdown: string) => {
    await navigator.clipboard.writeText(markdown);
    setCopied((c) => ({ ...c, details: true }));
    setMessage('Details copied. Paste them into your agent.');
  };

  const copyPrompt = async (markdown: string) => {
    await navigator.clipboard.writeText(markdown);
    setMessage('Copied. Paste it into your agent.');
  };

  // The bug list: the linked folder's bugs, or the cloud inbox's.
  const shown = folder ? captures : session ? cloudBugs : [];

  return (
    <main className="space-y-4 p-4 text-sm text-gray-900">
      <header>
        <h1 className="text-base font-semibold">{PRODUCT.NAME}</h1>
        {!folder && cloud === false && <Welcome onLink={linkFolder} onCloud={() => chooseCloud(true)} />}
        {!folder && cloud && session && (
          <p className="mt-1 text-xs text-gray-500">
            Sending bugs to your Darnly inbox ({session.email}) ·{' '}
            <button className="underline" onClick={linkFolder}>link a folder instead</button>
          </p>
        )}
        {!folder && cloud && !session && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
            <p className="font-medium">Send bugs straight to your agent</p>
            <p className="text-xs text-gray-500">Sign in once, and each bug goes to your private Darnly inbox. Your agent picks it up there, with nothing to paste.</p>
            <button className="w-full rounded-lg bg-gray-900 py-2 text-white" onClick={cloudSignIn}>Sign in with Google</button>
            <p className="text-xs text-gray-500">
              Or copy each bug into your agent by hand ·{' '}
              <button className="underline" onClick={linkFolder}>link a folder instead</button>
            </p>
          </div>
        )}
        {folder && <FolderLine folder={folder} access={access} onLink={linkFolder} />}
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

      {stage === 'picking' && (
        <section className="space-y-2 rounded-lg bg-rose-50 p-3 text-rose-800">
          <p>Click the broken part of the page. Press W for the whole page, Esc to cancel.</p>
          <div className="flex gap-2">
            <button className="flex-1 rounded-lg border border-rose-200 bg-white py-1.5" onClick={() => pickerCommand('whole')}>Whole page</button>
            <button className="flex-1 rounded-lg border border-rose-200 bg-white py-1.5" onClick={() => pickerCommand('cancel')}>Cancel</button>
          </div>
        </section>
      )}

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
            placeholder="What should it do or look like? e.g. Should look flat, like the Beliefs pills"
          />
          <div className="flex gap-2">
            <button className="flex-1 rounded-lg bg-gray-900 py-2 text-white" onClick={save}>Save (Enter)</button>
            <button className="rounded-lg border border-gray-300 px-3" onClick={() => copyPrompt(build(capture).paste)}>Copy as prompt</button>
            <button className="rounded-lg px-3 text-gray-500" onClick={() => { setStage('idle'); setCapture(null); }}>Cancel</button>
          </div>
          <p className="text-xs text-gray-500">Shift+Enter for a new line.</p>
        </section>
      )}

      {stage === 'saved' && (
        <section className="space-y-2">
          {sentToCloud ? (
            <>
              <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Sent to your Darnly inbox</p>
              <p className="text-gray-600">Tell your agent: <em>"fix my Darnly bugs"</em></p>
            </>
          ) : lastFile ? (
            <>
              <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Saved to <code>{lastFile}</code></p>
              <p className="text-gray-600">Tell your agent: <em>"fix the bugs in {INBOX_FOLDER}"</em></p>
            </>
          ) : (
            <p className="text-gray-600">Bug ready. Copy the picture and the details into your agent's chat (Claude, Codex, Cursor).</p>
          )}
          <DragCard files={lastFiles} title={lastTitle} linked={!!lastFile || sentToCloud} />
          {sentToCloud && <p className="text-xs text-gray-500">Agent not connected yet? Copy it by hand:</p>}
          <div className="flex gap-2">
            {lastFiles.some((f) => f.type === 'image/png') && (
              <button className="flex-1 rounded-lg border border-gray-300 py-2" onClick={() => copyPicture(lastFiles)}>1. Copy picture{copied.picture ? ' ✓' : ''}</button>
            )}
            <button className="flex-1 rounded-lg border border-gray-300 py-2" onClick={() => copyDetails(lastPaste)}>2. Copy details{copied.details ? ' ✓' : ''}</button>
          </div>
          <button className="w-full rounded-lg border border-gray-300 py-2" onClick={startFromPanel}>Capture another</button>
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

      {justFixed.length > 0 && (
        <section className="rounded-lg bg-emerald-50 p-3 text-emerald-900">
          <p className="font-medium">{justFixed.length === 1 ? '1 bug fixed' : `${justFixed.length} bugs fixed`}. Take a look.</p>
          <ul className="mt-1 space-y-1">
            {justFixed.slice(0, 5).map((c) => (
              <li key={c.id} className="text-xs">
                <span className="font-medium">{c.title}</span>
                {c.fixedNote && <span className="block text-emerald-800">{c.fixedNote}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-lg border border-emerald-300 bg-white py-1.5" onClick={() => chrome.tabs.reload().catch(() => {})}>Reload the page</button>
            <button className="rounded-lg px-3 text-emerald-800" onClick={() => setJustFixed([])}>Done</button>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section>
          <p className="font-medium">
            Captured bugs <span className="font-normal text-gray-500">· {shown.filter((c) => c.status === 'waiting').length} waiting, {shown.filter((c) => c.status === 'fixed').length} fixed</span>
          </p>
          <ul className="mt-2 divide-y divide-gray-100">
            {shown.slice(0, 20).map((c) => (
              <li key={c.status + c.id} className="flex items-center gap-2 py-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === 'fixed' ? 'bg-emerald-500' : 'bg-amber-400'}`} title={c.status === 'fixed' ? 'Fixed' : 'Waiting for your agent'} />
                <span className={`truncate ${c.status === 'fixed' ? 'text-gray-400 line-through' : ''}`} title={c.fixedNote ? `${c.title}\nFixed: ${c.fixedNote}` : c.title}>{c.title}</span>
              </li>
            ))}
          </ul>
          {shown.some((c) => c.status === 'waiting') && (
            <p className="mt-2 text-xs text-gray-500">Tell your agent: <em>{folder ? `"fix the bugs in ${INBOX_FOLDER}"` : '"fix my Darnly bugs"'}</em></p>
          )}
        </section>
      )}
      {stats.length >= 3 && (
        <p className="text-xs text-gray-500">
          Average capture: {Math.round(stats.reduce((a, b) => a + b.ms, 0) / stats.length / 1000)}s over {stats.length} bugs
          {shown.length ? ` · ${shown.filter((c) => c.status === 'fixed').length} of ${shown.length} fixed` : ''}
        </p>
      )}
      {!folder && session && (
        <section className="space-y-2 border-t border-gray-100 pt-3">
          <details className="rounded-lg border border-gray-200 p-3" open={cloudBugs.length === 0}>
            <summary className="cursor-pointer font-medium">Connect your agent (once)</summary>
            <p className="mt-2 text-gray-600">Add this address as a connector (MCP server) in your agent, then sign in with the same Google account:</p>
            <div className="mt-2 flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-2 py-1.5 text-xs" title={mcp}>{mcp}</code>
              <button className="rounded-lg border border-gray-300 px-3" onClick={() => navigator.clipboard.writeText(mcp).then(() => setMessage('Connector address copied.'))}>Copy</button>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-gray-500">
              <li>Claude: Settings, Connectors, Add custom connector</li>
              <li>Claude Code: <code>claude mcp add --transport http darnly {mcp}</code></li>
              <li>Cursor: Settings, MCP, Add new MCP server</li>
            </ul>
          </details>
          <p className="text-xs text-gray-500">
            {session.email} · <button className="underline" onClick={cloudSignOut}>Sign out</button> ·{' '}
            {confirmDelete ? (
              <>
                Delete every bug in your inbox? <button className="font-medium text-rose-700 underline" onClick={cloudDeleteAll}>Yes, delete</button>{' '}
                <button className="underline" onClick={() => setConfirmDelete(false)}>Keep</button>
              </>
            ) : (
              <button className="underline" onClick={() => setConfirmDelete(true)}>Delete all my cloud bugs</button>
            )}
          </p>
        </section>
      )}
    </main>
  );
}

function toSummary(b: CloudBug): CaptureSummary {
  return { id: b.id, title: b.title, status: b.status, modified: b.fixedAt ?? b.createdAt, fixedNote: b.fixedNote ?? undefined };
}

function Welcome({ onLink, onCloud }: { onLink: () => void; onCloud: () => void }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
      <p className="font-medium">Where does your project's code live?</p>
      <button className="w-full rounded-lg bg-gray-900 py-2 text-white" onClick={onLink}>On this computer: link the folder</button>
      <p className="text-xs text-gray-500">Bugs are saved into the project, and your agent finds them there.</p>
      <button className="w-full rounded-lg border border-gray-300 py-2" onClick={onCloud}>In the cloud (Claude, Codex or Cursor online)</button>
      <p className="text-xs text-gray-500">Each bug stays here, and you copy it into your agent's chat.</p>
    </div>
  );
}

function FolderLine({ folder, access, onLink }: { folder: FileSystemDirectoryHandle | null; access: string; onLink: () => void }) {
  if (!folder) {
    return (
      <>
        <button className="mt-2 w-full rounded-lg bg-gray-900 py-2 text-white" onClick={onLink}>
          Link your project folder
        </button>
        <p className="mt-1 text-xs text-gray-500">Project lives in the cloud? Skip this. Each bug stays here for you to drag into your agent.</p>
      </>
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
    markScreenshot(capture.screenshot!, capture.page.viewport.width, capture.element?.rect, capture.element?.atCursor && capture.element.point).then((b) => {
      revoked = URL.createObjectURL(b);
      setUrl(revoked);
    });
    return () => URL.revokeObjectURL(revoked);
  }, [capture]);
  return url ? <img src={url} alt="Screenshot with the picked element outlined" className="w-full rounded-lg border border-gray-200" /> : null;
}

/** The saved bug as a card you drag into an agent's chat; the drop carries the markdown and the screenshot as files. */
function DragCard({ files, title, linked }: { files: File[]; title: string; linked: boolean }) {
  const png = files.find((f) => f.type === 'image/png');
  const [thumb, setThumb] = useState('');
  useEffect(() => {
    if (!png) return;
    // A data URL (not a blob URL) so Chrome can hand the picture to desktop apps as a real file when dragged.
    const r = new FileReader();
    r.onload = () => setThumb(String(r.result));
    r.readAsDataURL(png);
  }, [png]);
  if (!files.length) return null;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        for (const f of files) e.dataTransfer.items.add(f);
        // Lets a desktop app or Finder take the markdown when it doesn't accept dropped files from a web page.
        const md = files.find((f) => f.name.endsWith('.md'));
        if (md) e.dataTransfer.setData('DownloadURL', `text/markdown:${md.name}:${URL.createObjectURL(md)}`);
      }}
      className="flex cursor-grab items-center gap-3 rounded-lg border border-dashed border-gray-400 bg-gray-50 p-2 active:cursor-grabbing"
      title="Drag into your agent's chat"
    >
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="h-14 w-20 cursor-grab rounded border border-gray-300 object-cover"
          title="Drag this picture into your agent (works with desktop apps)"
          onDragStart={(e) => {
            // Let Chrome's own image drag run: it gives desktop apps a real PNG file.
            e.stopPropagation();
            e.dataTransfer.setData('DownloadURL', `image/png:${png!.name}:${thumb}`);
          }}
        />
      )}
      <div className="min-w-0">
        <p className="truncate font-medium">{title || 'Bug report'}</p>
        <p className="text-xs text-gray-500">Your note is written on the picture.</p>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-gray-300 bg-gray-50 px-1 text-xs">{children}</kbd>;
}
