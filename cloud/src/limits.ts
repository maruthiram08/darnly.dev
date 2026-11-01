// Limits that keep the cloud bill small even if someone scripts against it.
// Per user: captures a day and total storage. For everyone together: captures, bytes and new sign-ups a day.
// Plus two off switches: UPLOADS_OFF (set by hand) and the spend meter's pause (set automatically, see spend.ts).
import type { Env } from './env';
import { HttpError } from './util';

export const CAPS = {
  userUploadsPerDay: 200,
  userStoredBytes: 1024 * 1024 * 1024, // 1 GB
  allUploadsPerDay: 20_000,
  allBytesPerDay: 20 * 1024 * 1024 * 1024, // 20 GB
  allSignupsPerDay: 500,
  keepUsageDays: 7,
};

/** KV key the spend meter writes when it pauses uploads. Its value is the billing month it was set in. */
export const PAUSE_KEY = 'config:paused';

export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Month the billing period started in, like 2026-11, given the day of the month the period starts. */
export function billingMonth(now: number, startDay = 1): string {
  const d = new Date(now);
  if (d.getUTCDate() < startDay) d.setUTCMonth(d.getUTCMonth() - 1, 1);
  return d.toISOString().slice(0, 7);
}

/** True when uploads and new sign-ups are switched off, by hand or by the spend meter (for this billing month). */
export async function isPaused(env: Env, now = Date.now()): Promise<boolean> {
  if (env.UPLOADS_OFF === 'true') return true;
  const month = await env.OAUTH_KV.get(PAUSE_KEY);
  return month != null && month === billingMonth(now, Number(env.BILLING_DAY ?? 1) || 1);
}

async function bump(env: Env, scope: string, day: string, uploads: number, bytes: number, signups: number) {
  return env.DB.prepare(
    `INSERT INTO usage (scope, day, uploads, bytes, signups) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope, day) DO UPDATE SET uploads = uploads + excluded.uploads, bytes = bytes + excluded.bytes, signups = signups + excluded.signups
     RETURNING uploads, bytes, signups`,
  )
    .bind(scope, day, uploads, bytes, signups)
    .first<{ uploads: number; bytes: number; signups: number }>();
}

/**
 * Counts one upload before it is stored. The user's own count goes first, so one account
 * at its cap can't use up everyone's allowance. Attempts count even when refused.
 */
export async function countUpload(env: Env, userId: string, bytes: number, now = Date.now()): Promise<void> {
  const day = today(now);
  const mine = await bump(env, userId, day, 1, bytes, 0);
  if ((mine?.uploads ?? 0) > CAPS.userUploadsPerDay) throw new HttpError(429, 'daily_limit');
  const all = await bump(env, '*', day, 1, bytes, 0);
  if ((all?.uploads ?? 0) > CAPS.allUploadsPerDay || (all?.bytes ?? 0) > CAPS.allBytesPerDay) throw new HttpError(503, 'cloud_busy');
}

/** Counts a new account. Over the daily ceiling, or while paused, new accounts wait until tomorrow. Existing users are never blocked here. */
export async function countSignup(env: Env, now = Date.now()): Promise<void> {
  if (await isPaused(env, now)) throw new HttpError(503, 'signups_paused');
  const all = await bump(env, '*', today(now), 0, 0, 1);
  if ((all?.signups ?? 0) > CAPS.allSignupsPerDay) throw new HttpError(503, 'signups_paused');
}

export async function deleteOldUsage(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(today(now - CAPS.keepUsageDays * 86_400_000)).run();
}

/**
 * Per-IP limits with Cloudflare's rate limiting binding. Requests it refuses are still
 * small Worker requests; the WAF rule in DEPLOY.md stops floods before they reach the Worker.
 */
export async function rateLimit(env: Env, req: Request, kind: 'write' | 'any'): Promise<Response | null> {
  const limiter = kind === 'write' ? env.WRITE_LIMITER : env.ANY_LIMITER;
  // Cloudflare sets cf-connecting-ip on every real request; local tests don't.
  const ip = req.headers.get('cf-connecting-ip');
  if (!limiter || !ip) return null;
  const { success } = await limiter.limit({ key: `${kind}:${ip}` });
  if (success) return null;
  return new Response(JSON.stringify({ error: 'slow_down' }), { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60' } });
}
