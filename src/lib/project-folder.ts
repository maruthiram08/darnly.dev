import { ROOT_FOLDER } from '@/config/product';

/**
 * The linked project folder, stored in IndexedDB (folder handles can't go in chrome.storage).
 * v1 links one folder; per-site linking comes in Sprint 3.
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

export async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
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
      out.push({ id: name.replace(/\.md$/, ''), title, status, modified: file.lastModified, fixedNote });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}
