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
