// The cloud inbox: for projects whose code isn't on this computer.
// Bugs are uploaded to Darnly cloud, and the coding agent reads them through MCP.

/** Can be changed in chrome.storage.local (`cloudUrl`) for local testing. */
export const CLOUD_URL = 'https://api.darnly.dev';
export const MCP_PATH = '/mcp';

export interface CloudSession {
  token: string;
  email: string;
}

export interface CloudBug {
  id: string;
  title: string;
  pageUrl: string;
  site: string;
  status: 'waiting' | 'fixed';
  fixedNote: string | null;
  createdAt: number;
  fixedAt: number | null;
}

export class CloudError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function cloudUrl(): Promise<string> {
  const { cloudUrl } = await chrome.storage.local.get('cloudUrl').catch(() => ({ cloudUrl: undefined }));
  return typeof cloudUrl === 'string' && /^https?:\/\//.test(cloudUrl) ? cloudUrl.replace(/\/+$/, '') : CLOUD_URL;
}

export async function mcpUrl(): Promise<string> {
  return (await cloudUrl()) + MCP_PATH;
}

export async function loadSession(): Promise<CloudSession | null> {
  const { cloudSession } = await chrome.storage.local.get('cloudSession').catch(() => ({ cloudSession: undefined }));
  const s = cloudSession as Partial<CloudSession> | undefined;
  return s && typeof s.token === 'string' && typeof s.email === 'string' ? { token: s.token, email: s.email } : null;
}

async function saveSession(s: CloudSession | null): Promise<void> {
  if (s) await chrome.storage.local.set({ cloudSession: s });
  else await chrome.storage.local.remove('cloudSession');
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch((await cloudUrl()) + path, { ...rest, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    // A session the server no longer knows: forget it so the panel asks to sign in again.
    if (res.status === 401 && token) await saveSession(null);
    throw new CloudError(res.status, body.error ?? `http_${res.status}`);
  }
  return body as T;
}

/** Signs in with the Google account in Chrome (Chrome shows its own account picker). */
export async function signInWithGoogle(): Promise<CloudSession> {
  const result = await chrome.identity.getAuthToken({ interactive: true });
  const accessToken = typeof result === 'string' ? result : result?.token;
  if (!accessToken) throw new CloudError(0, 'google_cancelled');
  const r = await call<{ token: string; email: string }>('/v1/auth/google', { method: 'POST', body: JSON.stringify({ accessToken }) });
  const s = { token: r.token, email: r.email };
  await saveSession(s);
  return s;
}

/** Local development only: the server accepts this just when ALLOW_DEV_LOGIN is on. */
export async function signInForDev(email: string): Promise<CloudSession> {
  const r = await call<{ token: string; email: string }>('/v1/auth/google', { method: 'POST', body: JSON.stringify({ devEmail: email }) });
  const s = { token: r.token, email: r.email };
  await saveSession(s);
  return s;
}

export async function signOut(s: CloudSession): Promise<void> {
  await call('/v1/auth/logout', { method: 'POST', token: s.token }).catch(() => {});
  await saveSession(null);
}

export interface Upload {
  title: string;
  pageUrl: string;
  report: string;
  picture?: Blob;
  logs?: string;
}

export async function uploadBug(s: CloudSession, u: Upload): Promise<CloudBug> {
  const form = new FormData();
  form.set('meta', JSON.stringify({ title: u.title, pageUrl: u.pageUrl }));
  form.set('report', new File([u.report], 'report.md', { type: 'text/markdown' }));
  if (u.picture) form.set('picture', new File([u.picture], 'picture.png', { type: 'image/png' }));
  if (u.logs) form.set('logs', u.logs);
  return call<CloudBug>('/v1/bugs', { method: 'POST', body: form, token: s.token });
}

export async function listCloudBugs(s: CloudSession): Promise<CloudBug[]> {
  return (await call<{ bugs: CloudBug[] }>('/v1/bugs?limit=50', { token: s.token })).bugs;
}

export async function deleteAllCloudBugs(s: CloudSession): Promise<number> {
  return (await call<{ deleted: number }>('/v1/bugs', { method: 'DELETE', token: s.token })).deleted;
}
