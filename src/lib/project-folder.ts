import { ROOT_FOLDER } from '@/config/product';

/**
 * The linked project folder, stored in IndexedDB (folder handles can't go in chrome.storage).
 * Each site remembers its own folder (`site:<origin>`), plus a list of recent folders (`recent`).
 * `project` is the last folder used, and was the only one before per-site projects.
 */
const DB = 'darnly-folders';
const STORE = 'handles';
const KEY = 'project';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (value == null) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(KEY, handle);
}

export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  return idbGet<FileSystemDirectoryHandle>(KEY);
}

/** The site part of a page address (https://app.example.com), or null for pages without one. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

const MAX_RECENT = 8;

async function sameFolder(a: FileSystemDirectoryHandle, b: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b);
  } catch {
    return a.name === b.name;
  }
}

/** Project folders the user linked, most recent first. */
export async function recentFolders(): Promise<FileSystemDirectoryHandle[]> {
  const list = (await idbGet<FileSystemDirectoryHandle[]>('recent')) ?? [];
  if (list.length) return list;
  // Before per-site projects, one folder was linked: it becomes the first recent one.
  const last = await loadFolder();
  return last ? [last] : [];
}

/** Where bugs from one site go: its own folder, the cloud inbox, or (several projects, new site) ask the user. */
export type Target =
  | { kind: 'folder'; handle: FileSystemDirectoryHandle }
  | { kind: 'cloud' }
  | { kind: 'ask'; recent: FileSystemDirectoryHandle[] }
  | { kind: 'none' };

async function cloudSites(): Promise<Record<string, boolean>> {
  try {
    const r = await chrome.storage.local.get('siteCloud');
    return (r.siteCloud as Record<string, boolean> | undefined) ?? {};
  } catch {
    return {};
  }
}

/**
 * Each site remembers its project. A site seen for the first time goes to the only project there is
 * (and remembers it), or, when the user has several, the panel asks once which one it belongs to.
 */
export async function targetFor(origin: string | null, signedIn: boolean): Promise<Target> {
  if (origin) {
    if ((await cloudSites())[origin]) return { kind: 'cloud' };
    const mine = await idbGet<FileSystemDirectoryHandle>(`site:${origin}`);
    if (mine) return { kind: 'folder', handle: mine };
  }
  const recent = await recentFolders();
  let lastWasCloud = false;
  try {
    lastWasCloud = (await chrome.storage.local.get('cloudProject')).cloudProject === true;
  } catch {
    /* treat as not cloud */
  }
  const choices = recent.length + (signedIn || lastWasCloud ? 1 : 0);
  if (origin && choices >= 2) return { kind: 'ask', recent };
  if (!origin) {
    const last = await loadFolder();
    if (lastWasCloud) return { kind: 'cloud' };
    return last ? { kind: 'folder', handle: last } : { kind: 'none' };
  }
  if (recent.length === 1) {
    await chooseFolderFor(origin, recent[0]!);
    return { kind: 'folder', handle: recent[0]! };
  }
  if (lastWasCloud) {
    await chooseCloudFor(origin);
    return { kind: 'cloud' };
  }
  return { kind: 'none' };
}

/** Bugs from this site go into this folder from now on. */
export async function chooseFolderFor(origin: string | null, handle: FileSystemDirectoryHandle): Promise<void> {
  if (origin) {
    await idbSet(`site:${origin}`, handle);
    const sites = await cloudSites();
    if (sites[origin]) {
      delete sites[origin];
      await chrome.storage.local.set({ siteCloud: sites }).catch(() => {});
    }
  }
  await saveFolder(handle);
  const recent = await recentFolders();
  const rest: FileSystemDirectoryHandle[] = [];
  for (const r of recent) if (!(await sameFolder(r, handle))) rest.push(r);
  await idbSet('recent', [handle, ...rest].slice(0, MAX_RECENT));
  await chrome.storage.local.set({ cloudProject: false }).catch(() => {});
}

/** Bugs from this site go to the cloud inbox from now on. */
export async function chooseCloudFor(origin: string | null): Promise<void> {
  if (origin) {
    await idbSet(`site:${origin}`, null);
    const sites = await cloudSites();
    await chrome.storage.local.set({ siteCloud: { ...sites, [origin]: true } }).catch(() => {});
  }
  await chrome.storage.local.set({ cloudProject: true }).catch(() => {});
}

type Handle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

export async function folderAccess(handle: FileSystemDirectoryHandle | null): Promise<PermissionState | 'none'> {
  if (!handle) return 'none';
  return (handle as Handle).queryPermission({ mode: 'readwrite' });
}

/** Must run inside a click or key press: Chrome shows its "Allow" prompt at most once a session. */
export async function ensureAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as Handle;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

/** Deletes a captured bug: every file starting with its id, in .darnly/inbox or .darnly/done. */
export async function deleteCapture(root: FileSystemDirectoryHandle, id: string, status: 'waiting' | 'fixed'): Promise<void> {
  const dir = await dirAt(root, [ROOT_FOLDER, status === 'fixed' ? 'done' : 'inbox'], false);
  const names: string[] = [];
  for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (name === `${id}.md` || name.startsWith(`${id}.`)) names.push(name);
  }
  for (const n of names) await dir.removeEntry(n);
}

/** Writes files into <project>/.darnly/<sub>/, creating folders as needed. */
export async function writeToProject(
  handle: FileSystemDirectoryHandle,
  sub: string,
  files: Record<string, Blob | string>,
): Promise<void> {
  let dir = await handle.getDirectoryHandle(ROOT_FOLDER, { create: true });
  // Keep captures out of git without touching the project's own .gitignore (screenshots can hold private data).
  await dir.getFileHandle('.gitignore').catch(() => writeFile(dir, '.gitignore', '*\n'));
  for (const part of sub.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
  for (const [name, data] of Object.entries(files)) await writeFile(dir, name, data);
}

async function dirAt(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

/** Reads a text file by path relative to the project root; null when it doesn't exist. */
export async function readProjectFile(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  const parts = path.split('/');
  const name = parts.pop()!;
  try {
    const dir = await dirAt(root, parts, false);
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    return null;
  }
}

export async function writeProjectFile(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const parts = path.split('/');
  const name = parts.pop()!;
  await writeFile(await dirAt(root, parts, true), name, content);
}

export interface CaptureSummary {
  id: string;
  title: string;
  status: 'waiting' | 'fixed';
  modified: number;
  /** The agent's one line on what it changed (the **Fixed:** line), when it wrote one. */
  fixedNote?: string;
  /** The agent's question when it is waiting for the user (the **Question:** line), on bugs still waiting. */
  question?: string;
  /** The page the bug was captured on. */
  pageUrl?: string;
}

/** Captures in .darnly/inbox (waiting for the agent) and .darnly/done (the agent moved them there after fixing). */
export async function listCaptures(root: FileSystemDirectoryHandle): Promise<CaptureSummary[]> {
  const out: CaptureSummary[] = [];
  for (const [sub, status] of [['inbox', 'waiting'], ['done', 'fixed']] as const) {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await dirAt(root, [ROOT_FOLDER, sub], false);
    } catch {
      continue;
    }
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.md')) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      const text = await file.slice(0, 4000).text();
      // The note (under "Expected") names a bug best; older files had it as the heading.
      const expected = text.match(/^\*\*Expected:\*\* (.+)$/m)?.[1];
      const title = (expected && expected !== '(no note given)' ? expected : undefined) ?? text.match(/^# (.+)$/m)?.[1] ?? name;
      const fixedNote = text.match(/^\*\*Fixed:\*\* (.+)$/m)?.[1]?.slice(0, 200);
      const question = status === 'waiting' ? text.match(/^\*\*Question:\*\* (.+)$/m)?.[1]?.slice(0, 200) : undefined;
      const pageUrl = text.match(/^url: (.+)$/m)?.[1]?.trim().replace(/^"(.*)"$/, '$1');
      out.push({ id: name.replace(/\.md$/, ''), title, status, modified: file.lastModified, fixedNote, question, pageUrl });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}
