import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PRODUCT, INBOX_FOLDER } from '@/config/product';
import type { ElementInfo } from '@/lib/element-info';
import { captureId } from '@/lib/capture-name';
import { captureMarkdown, headingFrom } from '@/lib/capture-markdown';
import { markScreenshot, referencePng } from '@/lib/screenshot';
import { mergeLogs, type LogEntry } from '@/lib/logs';
import { chooseCloudFor, chooseFolderFor, deleteCapture, ensureAccess, folderAccess, listCaptures, originOf, recentFolders, targetFor, readProjectFile, saveFolder, writeProjectFile, writeToProject, type CaptureSummary } from '@/lib/project-folder';
import { CURSOR_COMMAND_PATH, HOOK_MARK, planSetup, type PlannedChange } from '@/lib/agent-setup';
import { cloudProjectName, saveCloudProjectName } from '@/lib/project-name';
import { checkFixes, isLocalPage, loadJustFixed, mergeFixed, saveJustFixed } from '@/lib/fix-watch';
import { CloudError, deleteAllCloudBugs, deleteCloudBug, listCloudBugs, loadSession, mcpUrl, signInWithGoogle, signOut, signOutEverywhere, uploadBug, type CloudBug, type CloudSession } from '@/lib/cloud-inbox';


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


/** Plain words for the cloud's limit errors. Anything else shows its code. */
function cloudReason(e: unknown): string {
  const code = (e as Error).message;
  const words: Record<string, string> = {
    daily_limit: 'you reached today\'s limit of 200 cloud bugs',
    too_many_this_hour: 'too many bugs this hour',
    inbox_full: 'your cloud inbox has 500 waiting bugs',
    storage_full: 'your cloud inbox is full',
    cloud_busy: 'Darnly cloud is busy today',
    uploads_paused: 'cloud uploads are paused for now',
    slow_down: 'too many requests, try again in a minute',
  };
  return words[code] ?? code;
}

export function App() {
  const [stage, setStage] = useState<Stage>('idle');
  const [capture, setCapture] = useState<PendingCapture | null>(null);
  const [note, setNote] = useState('');
  // Optional picture of what it should look like, pasted or dropped into the note box.
  const [reference, setReference] = useState<{ png: Blob; url: string } | null>(null);
  const addReference = async (file: File | Blob) => {
    try {
      const png = await referencePng(file);
      setReference((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { png, url: URL.createObjectURL(png) };
      });
    } catch {
      setMessage("Couldn't read that picture. Try a PNG or JPEG.");
    }
  };
  const clearReference = () =>
    setReference((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const folderRef = useRef<FileSystemDirectoryHandle | null>(null);
  folderRef.current = folder;
  // Several projects and a site Darnly hasn't seen yet: the panel asks which project it belongs to.
  const [askRecent, setAskRecent] = useState<FileSystemDirectoryHandle[] | null>(null);
  // The project name this site's cloud bugs go under, so each agent can ask for only its own.
  const [cloudName, setCloudName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [recent, setRecent] = useState<FileSystemDirectoryHandle[]>([]);
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
  // Bugs the agent fixed since the panel last looked (even with the panel closed), for the "take a look" nudge.
  const [justFixed, setJustFixedState] = useState<CaptureSummary[]>([]);
  const setJustFixed = useCallback((next: (prev: CaptureSummary[]) => CaptureSummary[]) => {
    setJustFixedState((prev) => {
      const v = next(prev);
      saveJustFixed(v);
      return v;
    });
  }, []);
  useEffect(() => {
    loadJustFixed().then((saved) => saved.length && setJustFixedState((prev) => mergeFixed(saved, prev)));
  }, []);
  // Capture times (shortcut to saved), kept on this computer, for the MVP success check.
  const [stats, setStats] = useState<{ ms: number }[]>([]);
  useEffect(() => {
    chrome.storage.local.get('captureTimes').then((r) => setStats(Array.isArray(r.captureTimes) ? r.captureTimes : []), () => {});
  }, []);
  const [plan, setPlan] = useState<PlannedChange[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  // Our Claude Code hooks are in this project, so Claude Code brings up new bugs by itself.
  const [hooksOn, setHooksOn] = useState(false);
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
  const sessionRef = useRef<CloudSession | null>(null);
  sessionRef.current = session;
  const [cloudBugs, setCloudBugs] = useState<CaptureSummary[]>([]);
  const [mcp, setMcp] = useState('');
  const [sentToCloud, setSentToCloud] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    loadSession().then(setSession, () => {});
    mcpUrl().then(setMcp, () => {});
  }, []);
  const refreshCloud = useCallback(async (s: CloudSession | null) => {
    if (!s) return;
    try {
      const list = (await listCloudBugs(s)).map(toSummary);
      const fixedNow = await checkFixes(`cloud:${s.email}`, list);
      if (fixedNow.length) setJustFixed((prev) => mergeFixed(prev, fixedNow));
      setCloudBugs(list);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) setSession(null);
    }
  }, [setJustFixed]);
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
      // Keep Google's own reason visible: "bad client id" and friends are how setup mistakes show up.
      setMessage(
        /oauth2 not granted|client id|wrong_google_client|invalid_client/i.test(why)
          ? `Google sign-in isn't set up for this copy of Darnly yet (${why}). Copy each bug into your agent for now.`
          : `Couldn't sign in: ${why}`,
      );
    }
  };
  const cloudSignOut = async () => {
    if (session) await signOut(session);
    setSession(null);
    setCloudBugs([]);
  };
  const cloudSignOutEverywhere = async () => {
    if (!session) return;
    try {
      await signOutEverywhere(session);
    } catch (e) {
      setMessage(`Couldn't sign out everywhere: ${(e as Error).message}`);
      return;
    }
    setSession(null);
    setCloudBugs([]);
    setMessage('Signed out on every computer, and every coding agent is disconnected. Add the connector again to reconnect one.');
  };
  const cloudDeleteAll = async () => {
    if (!session) return;
    try {
      const n = await deleteAllCloudBugs(session);
      setMessage(`Deleted ${n} ${n === 1 ? 'bug' : 'bugs'} from your Darnly inbox.`);
      setCloudBugs([]);
    } catch (e) {
      setMessage(`Couldn't delete: ${(e as Error).message}`);
    }
    setConfirmDelete(false);
  };

  const activeOrigin = async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
    return originOf(tab?.url);
  };
  const chooseCloud = async (v: boolean) => {
    if (v) await chooseCloudFor(await activeOrigin()).catch(() => {});
    setCloud(v);
    if (v) await refreshFolderRef.current();
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
    const fixedNow = await checkFixes(`folder:${f.name}`, list);
    if (fixedNow.length) setJustFixed((prev) => mergeFixed(prev, fixedNow));
    setCaptures(list);
    const paths = ['AGENTS.md', 'CLAUDE.md', '.gitignore', '.claude/settings.json', CURSOR_COMMAND_PATH, `.agents/skills/${PRODUCT.SLUG}/SKILL.md`, `.claude/skills/${PRODUCT.SLUG}/SKILL.md`];
    const existing = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await readProjectFile(f, p)] as const)));
    const next = planSetup(existing, f.name);
    setPlan(next);
    setSetupNeeded(next.length > 0);
    setHooksOn(!!existing['.claude/settings.json']?.includes(HOOK_MARK));
  }, [setJustFixed]);

  // Works out this tab's project (each site remembers its own) and shows it.
  const refreshFolder = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
    const t = await targetFor(originOf(tab?.url), !!sessionRef.current);
    if (t.kind === 'cloud') setCloudName(await cloudProjectName(originOf(tab?.url), tab?.url, tab?.title));
    setRecent(await recentFolders());
    const f = t.kind === 'folder' ? t.handle : null;
    setAskRecent(t.kind === 'ask' ? t.recent : null);
    if (t.kind !== 'ask') setCloud(t.kind === 'cloud');
    const same = !!(f && folderRef.current && (await f.isSameEntry(folderRef.current).catch(() => false)));
    if (!same) {
      setFolder(f);
      setCaptures([]);
      setPlan(null);
      setSetupNeeded(false);
      setHooksOn(false);
    }
    setAccess(await folderAccess(f));
    await refreshProject(f);
  }, [refreshProject]);
  const refreshFolderRef = useRef(refreshFolder);
  refreshFolderRef.current = refreshFolder;

  // Fixes in the user's other projects still show up, whichever site is open.
  const watchOtherProjects = useCallback(async () => {
    for (const r of await recentFolders()) {
      if (folderRef.current && (await r.isSameEntry(folderRef.current).catch(() => false))) continue;
      if ((await folderAccess(r)) !== 'granted') continue;
      const fixedNow = await checkFixes(`folder:${r.name}`, await listCaptures(r).catch(() => []));
      if (fixedNow.length) setJustFixed((prev) => mergeFixed(prev, fixedNow));
    }
  }, [setJustFixed]);

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
    const poll = setInterval(() => {
      refreshProject(folderRef.current);
      watchOtherProjects();
    }, 5000);
    const onTab = () => {
      refreshSite();
      refreshFolder();
    };
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
        clearReference();
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
  }, [refreshFolder, refreshSite, refreshProject, watchOtherProjects]);

  const linkFolder = async () => {
    try {
      const handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ id: 'project', mode: 'readwrite' });
      await chooseFolderFor(await activeOrigin(), handle);
      await refreshFolder();
      setMessage('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessage(`Couldn't link that folder: ${(e as Error).message}`);
    }
  };

  // One bug, deleted from wherever it lives (its files in the project, or the cloud inbox).
  const [confirmBug, setConfirmBug] = useState<string | null>(null);
  const deleteOne = async (c: CaptureSummary) => {
    setConfirmBug(null);
    try {
      if (folder) {
        if (!(await ensureAccess(folder))) return setMessage('Darnly needs "Allow" to delete from your project.');
        await deleteCapture(folder, c.id, c.status);
        setCaptures((list) => list.filter((x) => x.id !== c.id));
        await refreshProject(folder);
      } else if (session) {
        await deleteCloudBug(session, c.id);
        setCloudBugs((list) => list.filter((x) => x.id !== c.id));
        refreshCloud(session);
      }
      setJustFixed((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      setMessage(`Couldn't delete that bug: ${cloudReason(e)}`);
    }
  };

  // This site's bugs go to the cloud inbox from now on (sign-in, or the signed-in inbox, shows next).
  const useCloud = async () => {
    setMessage('');
    await chooseCloud(true);
  };

  // This site belongs to one of the user's other projects.
  const pickProject = async (h: FileSystemDirectoryHandle) => {
    setMessage('');
    await chooseFolderFor(await activeOrigin(), h);
    await refreshFolder();
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
      reference: !!reference,
    };
    return {
      id,
      markdown: captureMarkdown(input),
      paste: captureMarkdown({ ...input, forPaste: true }),
      cloud: captureMarkdown({ ...input, forCloud: true }),
    };
  };

  // One save at a time: a slow upload must not turn extra clicks or Enter presses into copies.
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const uploadKey = useRef<{ for: unknown; key: string } | null>(null);
  const save = async () => {
    if (!capture || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    try {
      await saveOnce();
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };
  const saveOnce = async () => {
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
    // Saved with the bug, but not offered for dragging or copying (that stays at two files: report and screenshot).
    const referenceFile = reference ? { [`${id}.reference.png`]: reference.png } : {};
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
      clearReference();
      setMessage('');
    };
    // Cloud project, signed in: send it to the Darnly inbox, where the agent reads it through MCP.
    if (!folder && session) {
      try {
        if (uploadKey.current?.for !== capture) uploadKey.current = { for: capture, key: crypto.randomUUID() };
        const origin = originOf(capture.page.url);
        const project = await saveCloudProjectName(origin, await cloudProjectName(origin, capture.page.url, capture.page.title));
        setCloudName(project);
        await uploadBug(session, {
          project,
          clientId: uploadKey.current.key,
          title: headingFrom(note, capture.element),
          pageUrl: capture.page.url,
          report: cloudReport,
          picture: files[`${id}.png`] as Blob | undefined,
          reference: reference?.png,
          logs: files[`${id}.logs.json`] as string | undefined,
        });
        done('', true);
        refreshCloud(session);
      } catch (e) {
        done('');
        setMessage(`Couldn't send it to your Darnly inbox (${cloudReason(e)}). Copy it into your agent below instead.`);
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
      await writeToProject(folder, 'inbox', { ...files, ...referenceFile });
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

  const waiting = shown.filter((c) => c.status === 'waiting').length;
  const fixedCount = shown.filter((c) => c.status === 'fixed').length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <main className="space-y-3 p-3.5 text-sm text-ink">
      <header className="space-y-2.5">
        <div className="flex items-center gap-2">
          <img src="/icon/32.png" alt="" className="h-7 w-7 rounded-lg" />
          <h1 className="text-[15px] font-bold tracking-tight">{PRODUCT.NAME}</h1>
          {waiting > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{waiting} to fix</span>}
        </div>
        {askRecent && (
          <ProjectChooser site={site.origin} recent={askRecent} onPick={pickProject} onLink={linkFolder} onCloud={useCloud} />
        )}
        {!askRecent && !folder && cloud === false && <Welcome onLink={linkFolder} onCloud={useCloud} />}
        {!askRecent && !folder && cloud && session && (
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2">
            <Icon name="cloud" className="h-4 w-4 shrink-0 text-sky" />
            <p className="min-w-0 flex-1 text-xs text-ink-soft">
              <span className="block font-medium text-ink">Sending bugs to your Darnly inbox</span>
              <span className="block truncate">{session.email}</span>
              {renaming != null ? (
                <form
                  className="mt-1 flex items-center gap-1.5"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = await saveCloudProjectName(await activeOrigin(), renaming);
                    if (name) setCloudName(name);
                    setRenaming(null);
                  }}
                >
                  <input aria-label="Project name" className="w-32 rounded border border-line px-1.5 py-0.5 text-ink" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
                  <button className={linkCls}>Save</button>
                </form>
              ) : (
                <span className="block truncate">
                  Project <strong className="text-ink">{cloudName}</strong> ·{' '}
                  <button className={linkCls} onClick={() => setRenaming(cloudName)} title="Your agent asks Darnly for this project's bugs only">rename</button>
                </span>
              )}
            </p>
            <button className={linkCls + ' text-xs'} onClick={linkFolder}>link a folder instead</button>
          </div>
        )}
        {!askRecent && !folder && cloud && !session && (
          <div className={cardCls + ' space-y-2.5'}>
            <div className="flex items-center gap-2">
              <Icon name="cloud" className="h-4 w-4 text-sky" />
              <p className="font-semibold">Send bugs straight to your agent</p>
            </div>
            <p className="text-xs text-ink-soft">Sign in once, and each bug goes to your private Darnly inbox. Your agent picks it up there, with nothing to paste.</p>
            <button className={primaryCls} onClick={cloudSignIn}>Sign in with Google</button>
            <p className="text-xs text-ink-soft">
              Or copy each bug into your agent by hand ·{' '}
              <button className={linkCls} onClick={linkFolder}>link a folder instead</button>
            </p>
          </div>
        )}
        {folder && <FolderLine folder={folder} access={access} recent={recent} onPick={pickProject} onLink={linkFolder} onCloud={useCloud} />}
      </header>

      {site.recordable && !site.builtIn && !site.on && (
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-white p-3">
          <Icon name="pulse" className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-soft">Errors and failed requests aren't recorded on <strong className="text-ink">{site.origin?.replace(/^https?:\/\//, '')}</strong>.</p>
            <button className={secondaryCls + ' mt-2 w-full py-1.5 text-xs'} onClick={recordThisSite}>Record errors on this site</button>
          </div>
        </div>
      )}

      {stage === 'idle' && (
        <section className={cardCls + ' space-y-3'}>
          {shortcut ? (
            <div className="space-y-2 text-center">
              <div className="flex justify-center gap-1.5">
                {keysOf(shortcut).map((k, i) => <Kbd key={i} big>{k}</Kbd>)}
              </div>
              <p className="text-ink-soft">Press this on any page, then click the broken part.</p>
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900">
              <p>The keyboard shortcut isn't set, usually because another extension uses the same keys.</p>
              <button className="mt-2 w-full rounded-xl border border-amber-300 bg-white py-1.5 font-medium" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                Set a shortcut
              </button>
            </div>
          )}
          <button className={primaryCls + ' flex items-center justify-center gap-2'} onClick={startFromPanel}>
            <Icon name="target" className="h-4 w-4" />
            Capture a bug
          </button>
          {shown.length === 0 && (
            <ol className="space-y-1.5 border-t border-line pt-3 text-xs text-ink-soft">
              {['Click the broken part and say what you expected.', 'Darnly hands your agent the picture, the element and the errors.', 'You see here when your agent has fixed it.'].map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-wash text-[10px] font-bold text-sky">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {stage === 'picking' && (
        <section className="space-y-3 rounded-2xl border border-pink/30 bg-pink/5 p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pink" />
            </span>
            <div>
              <p className="font-semibold text-ink">Click the broken part of the page.</p>
              <p className="text-xs text-ink-soft">Press W for the whole page, Esc to cancel.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className={secondaryCls + ' flex-1'} onClick={() => pickerCommand('whole')}>Whole page</button>
            <button className={secondaryCls + ' flex-1'} onClick={() => pickerCommand('cancel')}>Cancel</button>
          </div>
        </section>
      )}

      {stage === 'note' && capture && (
        <section className={cardCls + ' space-y-3'}>
          {capture.screenshot && <MarkedPreview capture={capture} />}
          {capture.screenshotError && <p className="text-xs text-amber-700">No screenshot: {capture.screenshotError}</p>}
          <div className="flex flex-wrap gap-1.5">
            {capture.element && (
              <Chip title={capture.element.selector}>
                <span className="font-mono">{capture.element.tag}</span>
                {capture.element.text ? ` "${capture.element.text.slice(0, 30)}"` : ''}
              </Chip>
            )}
            {capture.recorder ? (
              <>
                <Chip tone={capture.logs.some((l) => l.kind !== 'request') ? 'bad' : 'plain'}>{plural(capture.logs.filter((l) => l.kind !== 'request').length, 'error', 'errors')}</Chip>
                <Chip tone={capture.logs.some((l) => l.kind === 'request') ? 'bad' : 'plain'}>{plural(capture.logs.filter((l) => l.kind === 'request').length, 'failed request', 'failed requests')}</Chip>
                <Chip>secrets hidden</Chip>
              </>
            ) : (
              <Chip>Errors not recorded on this site</Chip>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="block font-semibold" htmlFor="note">What did you expect?</label>
            <textarea
              id="note"
              ref={noteRef}
              className="w-full rounded-xl border border-line bg-white p-2.5 outline-none placeholder:text-ink-soft/60 focus:border-sky focus:ring-2 focus:ring-sky/20"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onPaste={(e) => {
                // A picture on the clipboard (and no text) is a picture of what it should look like.
                const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
                if (file && !e.clipboardData.getData('text/plain')) {
                  e.preventDefault();
                  addReference(file);
                }
              }}
              onDragOver={(e) => {
                if ([...e.dataTransfer.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))) e.preventDefault();
              }}
              onDrop={(e) => {
                const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
                if (file) {
                  e.preventDefault();
                  addReference(file);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="What should it do or look like? e.g. Should look flat, like the Beliefs pills"
            />
            {reference ? (
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <img src={reference.url} alt="What it should look like" className="h-10 max-w-[5rem] rounded-lg border border-line object-cover" />
                <span className="flex-1">Picture of what you want added</span>
                <button className={linkCls} onClick={clearReference}>Remove</button>
              </div>
            ) : (
              <p className="text-xs text-ink-soft">Optional: paste or drop a picture of what it should look like. Shift+Enter for a new line.</p>
            )}
          </div>
          <button className={primaryCls} onClick={save} disabled={saving}>
            {saving ? (!folder && session ? 'Sending…' : 'Saving…') : 'Save (Enter)'}
          </button>
          <div className="flex gap-2">
            <button className={secondaryCls + ' flex-1'} onClick={() => copyPrompt(build(capture).paste)}>Copy as prompt</button>
            <button className="rounded-xl px-3 text-ink-soft hover:text-ink" onClick={() => { setStage('idle'); setCapture(null); }}>Cancel</button>
          </div>
        </section>
      )}

      {stage === 'saved' && (
        <section className={cardCls + ' space-y-3'}>
          {sentToCloud ? (
            <>
              <Done title="Sent to your Darnly inbox" />
              <NextStep>Tell your agent: <em>"fix my Darnly bugs"</em></NextStep>
            </>
          ) : lastFile ? (
            <>
              <Done title={<>Saved to <span className="font-mono text-[12px]">{INBOX_FOLDER}</span></>} detail={lastFile.split('/').pop()} />
              {hooksOn ? (
                <NextStep>Claude Code will offer to fix it on your next message. In other agents, type <em>/darnly</em>.</NextStep>
              ) : (
                <NextStep>Tell your agent: <em>"fix the bugs in {INBOX_FOLDER}"</em></NextStep>
              )}
            </>
          ) : (
            <NextStep>Bug ready. Copy the picture and the details into your agent's chat (Claude, Codex, Cursor).</NextStep>
          )}
          <DragCard files={lastFiles} title={lastTitle} linked={!!lastFile || sentToCloud} />
          {sentToCloud && <p className="text-xs text-ink-soft">Agent not connected yet? Copy it by hand:</p>}
          <div className="flex gap-2">
            {lastFiles.some((f) => f.type === 'image/png') && (
              <button className={secondaryCls + ' flex-1'} onClick={() => copyPicture(lastFiles)}>1. Copy picture{copied.picture ? ' ✓' : ''}</button>
            )}
            <button className={secondaryCls + ' flex-1'} onClick={() => copyDetails(lastPaste)}>2. Copy details{copied.details ? ' ✓' : ''}</button>
          </div>
          <button className={primaryCls + ' flex items-center justify-center gap-2'} onClick={startFromPanel}>
            <Icon name="target" className="h-4 w-4" />
            Capture another
          </button>
        </section>
      )}

      {message && (
        <p className={`rounded-xl px-3 py-2 text-xs ${/^(couldn't|darnly needs|google sign-in|press )/i.test(message) ? 'bg-amber-50 text-amber-900' : 'bg-wash text-ink'}`} role="status">{message}</p>
      )}

      {folder && access === 'granted' && setupNeeded && plan && (
        <section className="rounded-2xl border border-sky/30 bg-wash p-3.5">
          <div className="flex items-center gap-2">
            <Icon name="spark" className="h-4 w-4 text-sky" />
            <p className="font-semibold">Set up this project</p>
          </div>
          <p className="mt-1 text-xs text-ink-soft">Adds a short note so Claude Code, Codex and Cursor know where your bug reports are, and tells Claude Code when new bugs come in.</p>
          {!showPlan ? (
            <button className={secondaryCls + ' mt-2.5 w-full py-1.5'} onClick={() => setShowPlan(true)}>See what it adds</button>
          ) : (
            <div className="mt-2.5 space-y-2">
              {plan.map((c) => (
                <details key={c.path} className="rounded-lg border border-line bg-white p-2">
                  <summary className="cursor-pointer text-xs"><strong>{c.action === 'create' ? 'Create' : 'Update'}</strong> <code>{c.path}</code></summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-ink-soft">{c.content}</pre>
                </details>
              ))}
              <div className="flex gap-2">
                <button className={primaryCls + ' flex-1 py-1.5'} onClick={applySetup}>Add these</button>
                <button className="rounded-xl px-3 text-ink-soft" onClick={() => setShowPlan(false)}>Not now</button>
              </div>
            </div>
          )}
        </section>
      )}

      {shown.some((c) => c.question) && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-amber-950" role="status">
          <div className="flex items-start gap-2">
            <Icon name="chat" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="font-semibold">Your agent is waiting for your input. Return to your agent.</p>
          </div>
          <ul className="mt-2 space-y-1.5 pl-6">
            {shown.filter((c) => c.question).slice(0, 3).map((c) => (
              <li key={c.id} className="text-xs">
                <span className="font-medium">{c.title}</span>
                <span className="block text-amber-800">{c.question}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {justFixed.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-950">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-3 w-3" /></span>
            <p className="font-semibold">{justFixed.length === 1 ? '1 bug fixed' : `${justFixed.length} bugs fixed`}. Take a look.</p>
          </div>
          <ul className="mt-2 space-y-1.5 pl-7">
            {justFixed.slice(0, 5).map((c) => (
              <li key={c.id} className="text-xs">
                <span className="font-medium">{c.title}</span>
                {c.fixedNote && <span className="block text-emerald-800">{c.fixedNote}</span>}
              </li>
            ))}
          </ul>
          {/* Reloading only shows the fix on a dev server; a live site changes once the user deploys. */}
          {justFixed.some((c) => !isLocalPage(c.pageUrl)) && (
            <p className="mt-2 pl-7 text-xs text-emerald-800">
              {justFixed.every((c) => !isLocalPage(c.pageUrl)) ? 'The fix is in your code. Deploy it to see it on your live site, or check it on your local copy.' : 'Fixes for live sites show there after you deploy.'}
            </p>
          )}
          <div className="mt-2.5 flex gap-2">
            {justFixed.some((c) => isLocalPage(c.pageUrl)) ? (
              <button className="flex-1 rounded-xl bg-emerald-600 py-1.5 font-medium text-white hover:bg-emerald-700" onClick={() => chrome.tabs.reload().catch(() => {})}>Reload the page</button>
            ) : (
              <span className="flex-1" />
            )}
            <button className="rounded-xl px-3 font-medium text-emerald-800" onClick={() => setJustFixed(() => [])}>Done</button>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className={cardCls + ' !p-0'}>
          <div className="flex items-baseline justify-between px-3.5 pb-1 pt-3">
            <p className="font-semibold">Captured bugs</p>
            <p className="text-xs text-ink-soft">{waiting} waiting, {fixedCount} fixed</p>
          </div>
          <ul className="divide-y divide-line/70 px-1.5 pb-1.5">
            {shown.slice(0, 20).map((c) => (
              <li key={c.status + c.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === 'fixed' ? 'bg-emerald-500' : c.question ? 'bg-pink' : 'bg-amber-400'}`} />
                <span className={`min-w-0 flex-1 truncate ${c.status === 'fixed' ? 'text-ink-soft line-through decoration-ink-soft/40' : ''}`} title={c.fixedNote ? `${c.title}\nFixed: ${c.fixedNote}` : c.title}>{c.title}</span>
                {confirmBug === c.status + c.id ? (
                  <span className="shrink-0 text-xs text-ink-soft">
                    Delete? <button className="font-semibold text-rose-700 underline" onClick={() => deleteOne(c)}>Yes</button>{' '}
                    <button className="underline" onClick={() => setConfirmBug(null)}>No</button>
                  </span>
                ) : (
                  <>
                    <StatusTag status={c.status === 'fixed' ? 'fixed' : c.question ? 'question' : 'waiting'} />
                    <button className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-soft/50 hover:bg-rose-50 hover:text-rose-700 group-hover:text-ink-soft" aria-label={`Delete ${c.title}`} title="Delete this bug" onClick={() => setConfirmBug(c.status + c.id)}>×</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {waiting > 0 && (
            <p className="border-t border-line px-3.5 py-2.5 text-xs text-ink-soft">{folder && hooksOn ? <>Claude Code will offer to fix these on your next message. In other agents, type <em>/darnly</em>.</> : <>Tell your agent: <em>{folder ? `"fix the bugs in ${INBOX_FOLDER}"` : '"fix my Darnly bugs"'}</em></>}</p>
          )}
        </section>
      )}
      {!folder && session && (
        <details className={cardCls} open={cloudBugs.length === 0}>
          <summary className="cursor-pointer font-semibold">Connect your agent (once)</summary>
          <p className="mt-2 text-xs text-ink-soft">Add this address as a connector (MCP server) in your agent, then sign in with the same Google account:</p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-wash px-2 py-1.5 text-xs" title={mcp}>{mcp}</code>
            <button className={secondaryCls + ' px-3 py-1'} onClick={() => navigator.clipboard.writeText(mcp).then(() => setMessage('Connector address copied.'))}>Copy</button>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-soft">
            <li>Claude: Settings, Connectors, Add custom connector</li>
            <li>Claude Code: <code>claude mcp add --transport http darnly {mcp}</code></li>
            <li>Cursor: Settings, MCP, Add new MCP server</li>
          </ul>
        </details>
      )}
      {(stats.length >= 3 || (!folder && session)) && (
        <footer className="space-y-1.5 border-t border-line pt-3 text-xs text-ink-soft">
          {stats.length >= 3 && (
            <p>
              Average capture: {Math.round(stats.reduce((a, b) => a + b.ms, 0) / stats.length / 1000)}s over {stats.length} bugs
              {shown.length ? ` · ${fixedCount} of ${shown.length} fixed` : ''}
            </p>
          )}
          {!folder && session && (
            <p>
              {session.email} · <button className="underline" onClick={cloudSignOut}>Sign out</button> ·{' '}
              <button className="underline" onClick={cloudSignOutEverywhere} title="Signs out every computer and disconnects every coding agent">Sign out everywhere</button> ·{' '}
              {confirmDelete ? (
                <>
                  Delete every bug in your inbox? <button className="font-medium text-rose-700 underline" onClick={cloudDeleteAll}>Yes, delete</button>{' '}
                  <button className="underline" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              ) : (
                <button className="underline" onClick={() => setConfirmDelete(true)}>Delete all my cloud bugs</button>
              )}
            </p>
          )}
        </footer>
      )}
    </main>
  );
}

const cardCls = 'rounded-2xl border border-line bg-white p-3.5 shadow-[0_1px_2px_rgba(11,34,48,0.05)]';
const primaryCls = 'w-full rounded-xl bg-sky py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-sky-deep disabled:opacity-60';
const secondaryCls = 'rounded-xl border border-line bg-white py-2 font-medium text-ink transition-colors hover:border-sky/40 hover:bg-wash';
const linkCls = 'font-medium text-sky underline-offset-2 hover:underline';

function toSummary(b: CloudBug): CaptureSummary {
  return { id: b.id, title: b.title, status: b.status, modified: b.fixedAt ?? b.createdAt, fixedNote: b.fixedNote ?? undefined, question: b.question ?? undefined, pageUrl: b.pageUrl || undefined };
}

/** "⌥⇧B" or "Alt+Shift+B" as separate keys. */
function keysOf(shortcut: string): string[] {
  return shortcut.includes('+') ? shortcut.split('+') : [...shortcut];
}

function Welcome({ onLink, onCloud }: { onLink: () => void; onCloud: () => void }) {
  const option = (icon: IconName, title: string, text: string, onClick: () => void, main: boolean) => (
    <button
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${main ? 'border-sky bg-wash hover:bg-sky/10' : 'border-line bg-white hover:bg-wash'}`}
      onClick={onClick}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${main ? 'bg-sky text-white' : 'bg-wash text-sky'}`}><Icon name={icon} className="h-4 w-4" /></span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-ink-soft">{text}</span>
      </span>
    </button>
  );
  return (
    <div className={cardCls + ' space-y-2.5'}>
      <p className="font-semibold">Where does your project's code live?</p>
      {option('folder', 'On this computer: link the folder', 'Bugs are saved into the project, and your agent finds them there.', onLink, true)}
      {option('cloud', 'In the cloud (Claude, Codex or Cursor online)', 'Each bug goes to your Darnly inbox, or you copy it into your agent\'s chat.', onCloud, false)}
    </div>
  );
}

function ProjectChooser({ site, recent, onPick, onLink, onCloud }: { site?: string; recent: FileSystemDirectoryHandle[]; onPick: (h: FileSystemDirectoryHandle) => void; onLink: () => void; onCloud: () => void }) {
  return (
    <div className={cardCls + ' space-y-2.5'}>
      <div>
        <p className="font-semibold">Which project is {site ? site.replace(/^https?:\/\//, '') : 'this site'}?</p>
        <p className="text-xs text-ink-soft">Darnly remembers it for this site.</p>
      </div>
      <div className="space-y-1.5">
        {recent.map((r, i) => (
          <button key={i} className={secondaryCls + ' flex w-full items-center gap-2 px-3 text-left'} onClick={() => onPick(r)}>
            <Icon name="folder" className="h-4 w-4 text-sky" />
            {r.name}
          </button>
        ))}
        <button className={secondaryCls + ' flex w-full items-center gap-2 px-3 text-left'} onClick={onCloud}>
          <Icon name="cloud" className="h-4 w-4 text-sky" />
          In the cloud
        </button>
      </div>
      <button className={linkCls + ' text-xs'} onClick={onLink}>Another folder…</button>
    </div>
  );
}

function FolderLine({ folder, access, recent = [], onPick, onLink, onCloud }: { folder: FileSystemDirectoryHandle | null; access: string; recent?: FileSystemDirectoryHandle[]; onPick?: (h: FileSystemDirectoryHandle) => void; onLink: () => void; onCloud?: () => void }) {
  const [choosing, setChoosing] = useState(false);
  if (!folder) {
    return (
      <>
        <button className={primaryCls} onClick={onLink}>
          Link your project folder
        </button>
        <p className="mt-1 text-xs text-ink-soft">Project lives in the cloud? Skip this. Each bug stays here for you to drag into your agent.</p>
      </>
    );
  }
  const others = onPick ? recent.filter((r) => r.name !== folder.name).slice(0, 4) : [];
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-wash';
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Icon name="folder" className="h-4 w-4 shrink-0 text-sky" />
        <p className="min-w-0 flex-1 truncate text-xs text-ink-soft">
          Saving to <strong className="text-ink">{folder.name}</strong>
          {access !== 'granted' && ' (Chrome will ask to allow on your next save)'}
        </p>
        {!choosing && <button className={linkCls + ' text-xs'} onClick={() => (onCloud ? setChoosing(true) : onLink())}>change</button>}
      </div>
      {choosing && (
        <div className="border-t border-line p-1.5 text-xs">
          {others.map((r, i) => (
            <button key={i} className={item} onClick={() => { setChoosing(false); onPick!(r); }}>
              <Icon name="folder" className="h-3.5 w-3.5 text-ink-soft" />{r.name}
            </button>
          ))}
          <button className={item} onClick={() => { setChoosing(false); onLink(); }}>
            <Icon name="plus" className="h-3.5 w-3.5 text-ink-soft" />another folder
          </button>
          {onCloud && (
            <button className={item} onClick={() => { setChoosing(false); onCloud(); }}>
              <Icon name="cloud" className="h-3.5 w-3.5 text-ink-soft" />use the cloud instead
            </button>
          )}
          <button className={item + ' text-ink-soft'} onClick={() => setChoosing(false)}>cancel</button>
        </div>
      )}
    </div>
  );
}

function Done({ title, detail }: { title: ReactNode; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 p-3 text-emerald-950">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-3 w-3" /></span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {detail && <p className="truncate font-mono text-[11px] text-emerald-800" title={detail}>{detail}</p>}
      </div>
    </div>
  );
}

function NextStep({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-ink-soft">
      <Icon name="arrow" className="mt-0.5 h-4 w-4 shrink-0 text-sky" />
      <span>{children}</span>
    </p>
  );
}

function Chip({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'bad'; title?: string }) {
  return (
    <span title={title} className={`max-w-full truncate rounded-full px-2 py-0.5 text-[11px] ${tone === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-wash text-ink-soft'}`}>
      {children}
    </span>
  );
}

function StatusTag({ status }: { status: 'fixed' | 'question' | 'waiting' }) {
  const look = {
    fixed: ['Fixed', 'bg-emerald-50 text-emerald-700'],
    question: ['Needs you', 'bg-pink/10 text-pink'],
    waiting: ['Waiting', 'bg-amber-50 text-amber-700'],
  }[status];
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${look[1]}`}>{look[0]}</span>;
}

type IconName = 'folder' | 'cloud' | 'check' | 'target' | 'chat' | 'spark' | 'arrow' | 'plus' | 'pulse';
function Icon({ name, className }: { name: IconName; className?: string }) {
  const d: Record<IconName, string> = {
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12h.01M17.5 12a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    pulse: 'M3 12h4l2-6 4 12 2-6h6',
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'check' ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d[name]} />
    </svg>
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
  return url ? <img src={url} alt="Screenshot with the picked element outlined" className="max-h-52 w-full rounded-xl border border-line bg-wash object-contain" /> : null;
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
      className="flex cursor-grab items-center gap-3 rounded-xl border border-dashed border-sky/40 bg-wash p-2 active:cursor-grabbing"
      title="Drag into your agent's chat"
    >
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="h-14 w-20 cursor-grab rounded-lg border border-line object-cover"
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
        <p className="text-xs text-ink-soft">Drag into your agent&apos;s chat. Your note is on the picture.</p>
      </div>
    </div>
  );
}

function Kbd({ children, big }: { children: string; big?: boolean }) {
  return big ? (
    <kbd className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-line border-b-[3px] bg-white px-2.5 font-sans text-lg font-semibold text-ink shadow-sm">{children}</kbd>
  ) : (
    <kbd className="rounded border border-line bg-wash px-1 text-xs">{children}</kbd>
  );
}
