import type { Env } from './env';
import { HttpError, newId, newToken, sha256 } from './util';
import { countSignup } from './limits';

export interface User {
  id: string;
  email: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
}

/**
 * Checks a Google access token from chrome.identity.getAuthToken.
 * The token must be issued to OUR extension's OAuth client (aud), so a token
 * from another app can't be swapped in.
 */
async function verifyGoogleToken(env: Env, accessToken: string): Promise<GoogleIdentity> {
  if (!env.GOOGLE_EXTENSION_CLIENT_ID) throw new HttpError(503, 'google_not_configured');
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw new HttpError(401, 'bad_google_token');
  const info = (await res.json()) as { aud?: string; azp?: string; sub?: string; email?: string; email_verified?: string | boolean };
  const audience = info.aud ?? info.azp;
  if (audience !== env.GOOGLE_EXTENSION_CLIENT_ID) throw new HttpError(401, 'wrong_google_client');
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (!info.sub || !info.email || !verified) throw new HttpError(401, 'email_not_verified');
  return { sub: info.sub, email: info.email };
}

export async function upsertUser(env: Env, who: GoogleIdentity): Promise<User> {
  const found = await env.DB.prepare('SELECT id, email FROM users WHERE google_sub = ?').bind(who.sub).first<User>();
  if (found) {
    if (found.email !== who.email) await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(who.email, found.id).run();
    return { id: found.id, email: who.email };
  }
  await countSignup(env);
  const user = { id: newId('u'), email: who.email };
  await env.DB.prepare('INSERT INTO users (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)')
    .bind(user.id, who.sub, who.email, Date.now())
    .run();
  return user;
}

/** POST /v1/auth/google: trade a Google token for a Darnly session token. */
export async function signIn(env: Env, body: { accessToken?: unknown; devEmail?: unknown }): Promise<{ token: string; user: User }> {
  let who: GoogleIdentity;
  // Local development and tests only: ALLOW_DEV_LOGIN is never set in wrangler.jsonc.
  if (env.ALLOW_DEV_LOGIN === 'true' && typeof body.devEmail === 'string' && body.devEmail.includes('@')) {
    who = { sub: `dev:${body.devEmail}`, email: body.devEmail };
  } else if (typeof body.accessToken === 'string' && body.accessToken.length > 10) {
    who = await verifyGoogleToken(env, body.accessToken);
  } else {
    throw new HttpError(400, 'missing_token');
  }
  const user = await upsertUser(env, who);
  return { token: await createSession(env, user.id), user };
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now)
    .run();
  return token;
}

/** A session unused this long is signed out, so a token copied off an old laptop stops working. */
export const SESSION_IDLE_MS = 90 * 86_400_000;

/** Reads `Authorization: Bearer <token>` and returns the signed-in user, or throws 401. */
export async function requireUser(env: Env, req: Request): Promise<User> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
  if (!match) throw new HttpError(401, 'signed_out');
  const hash = await sha256(match[1]!);
  const row = await env.DB.prepare(
    'SELECT users.id AS id, users.email AS email, sessions.last_used_at AS last FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?',
  )
    .bind(hash)
    .first<User & { last: number }>();
  if (!row) throw new HttpError(401, 'signed_out');
  if (Date.now() - row.last > SESSION_IDLE_MS) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    throw new HttpError(401, 'signed_out');
  }
  // Touch at most once an hour to keep writes low.
  if (Date.now() - row.last > 3_600_000) {
    await env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').bind(Date.now(), hash).run();
  }
  return { id: row.id, email: row.email };
}

export async function signOut(env: Env, req: Request): Promise<void> {
  const match = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (match) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(match[1]!)).run();
}

/** Daily job: forget sessions nobody has used for SESSION_IDLE_MS. */
export async function deleteExpiredSessions(env: Env, now = Date.now()): Promise<number> {
  const res = await env.DB.prepare('DELETE FROM sessions WHERE last_used_at < ?').bind(now - SESSION_IDLE_MS).run();
  return res.meta.changes ?? 0;
}

/** Signs out every extension session of this user. */
export async function deleteAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
