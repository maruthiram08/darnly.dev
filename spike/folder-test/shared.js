// Shared code for the folder write test.
// This test has its own copy of the folder name; the real app keeps it in src/config/product.ts.
export const FOLDER_NAME = '.darnly';

const DB = 'folder-test';
const STORE = 'handles';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, 'project');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get('project');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function permissionState(handle) {
  if (!handle) return 'no folder';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    return 'error: ' + e.message;
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function makePng() {
  const canvas = new OffscreenCanvas(400, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 200);
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, 320, 120);
  ctx.fillStyle = '#111827';
  ctx.font = '20px sans-serif';
  ctx.fillText('Test capture ' + new Date().toLocaleTimeString(), 60, 108);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

// Writes one .md and one .png into <project>/.darnly/inbox/. Returns timing in ms.
export async function writeTestCapture(handle, source) {
  const t0 = performance.now();
  const root = await handle.getDirectoryHandle(FOLDER_NAME, { create: true });
  const inbox = await root.getDirectoryHandle('inbox', { create: true });
  const id = `${stamp()}-test-${source}`;
  const md = [
    '---',
    `id: ${id}`,
    `written_from: ${source}`,
    `captured: ${new Date().toISOString()}`,
    `browser: ${navigator.userAgent}`,
    '---',
    '# Folder write test',
    '',
    '**Expected:** this file and its PNG appear in the inbox within 1 second.',
    '',
    `**Screenshot:** ${FOLDER_NAME}/inbox/${id}.png`,
    '',
  ].join('\n');
  await writeFile(inbox, `${id}.md`, md);
  await writeFile(inbox, `${id}.png`, await makePng());
  return { id, ms: Math.round(performance.now() - t0) };
}
