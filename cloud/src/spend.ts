// The spend meter: once an hour, reads this billing month's usage for the whole Cloudflare
// account from Cloudflare's analytics, prices it, and acts:
//   - at SPEND_PAUSE_USD (default $50): new uploads and new sign-ups stop until next month;
//   - at SPEND_STOP_USD (default $85): api.darnly.dev is detached from the Worker, so no
//     request reaches it (and none is billed) until it is deployed again.
// Together with the $5 plan fee and up to an hour of lag, that keeps the month under $100.
// It needs CF_ACCOUNT_ID and CF_API_TOKEN (see DEPLOY.md). Without them it only logs.
import type { Env } from './env';
import { PAUSE_KEY, billingMonth } from './limits';

/** Workers Paid prices and included amounts, checked 2026-11-01 on developers.cloudflare.com. */
export const PRICES = {
  requests: { included: 10_000_000, perMillion: 0.3 },
  cpuMs: { included: 30_000_000, perMillion: 0.02 },
  r2ClassA: { included: 1_000_000, perMillion: 4.5 },
  r2ClassB: { included: 10_000_000, perMillion: 0.36 },
  r2StorageGB: { included: 10, perUnit: 0.015 },
  d1RowsRead: { included: 25_000_000_000, perMillion: 0.001 },
  d1RowsWritten: { included: 50_000_000, perMillion: 1 },
  kvReads: { included: 10_000_000, perMillion: 0.5 },
  kvWrites: { included: 1_000_000, perMillion: 5 },
  kvDeletes: { included: 1_000_000, perMillion: 5 },
  kvLists: { included: 1_000_000, perMillion: 5 },
};

export type Usage = { [K in keyof typeof PRICES]: number };

/** R2 operations that are free (deletes) and the ones billed as Class A. Everything else is Class B. */
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);
const R2_CLASS_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload',
  'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts', 'PutBucketEncryption',
  'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);

/** Usage-based cost in USD, on top of the $5 plan. Storage is priced as if today's size were kept all month, which errs high. */
export function estimateUsd(u: Usage): number {
  let usd = 0;
  for (const key of Object.keys(PRICES) as (keyof Usage)[]) {
    const p = PRICES[key] as { included: number; perMillion?: number; perUnit?: number };
    const over = Math.max(0, (u[key] ?? 0) - p.included);
    usd += p.perMillion != null ? (over / 1_000_000) * p.perMillion : over * (p.perUnit ?? 0);
  }
  return Math.round(usd * 100) / 100;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** One query per dataset, so a field Cloudflare renames breaks only that part. Workers and R2 are required. */
const PARTS: Record<keyof GqlAccount, string> = {
  workers: 'workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }) { sum { requests cpuTimeUs } }',
  r2ops: 'r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }) { sum { requests } dimensions { actionType } }',
  r2store: 'r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }) { max { payloadSize metadataSize } dimensions { bucketName } }',
  d1: 'd1AnalyticsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }) { sum { rowsRead rowsWritten } }',
  kv: 'kvOperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }) { sum { requests } dimensions { actionType } }',
};
const REQUIRED: (keyof GqlAccount)[] = ['workers', 'r2ops'];

interface GqlAccount {
  workers?: { sum: { requests?: number; cpuTimeUs?: number } }[];
  r2ops?: { sum: { requests?: number }; dimensions: { actionType?: string } }[];
  r2store?: { max: { payloadSize?: number; metadataSize?: number }; dimensions: { bucketName?: string } }[];
  d1?: { sum: { rowsRead?: number; rowsWritten?: number } }[];
  kv?: { sum: { requests?: number }; dimensions: { actionType?: string } }[];
}

/** Start of the current billing period (UTC), given the day of the month it starts on. */
export function periodStart(now: number, startDay = 1): Date {
  const [y, m] = billingMonth(now, startDay).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, startDay));
}

export function usageFrom(acct: GqlAccount): Usage {
  const u: Usage = { requests: 0, cpuMs: 0, r2ClassA: 0, r2ClassB: 0, r2StorageGB: 0, d1RowsRead: 0, d1RowsWritten: 0, kvReads: 0, kvWrites: 0, kvDeletes: 0, kvLists: 0 };
  for (const w of acct.workers ?? []) {
    u.requests += w.sum.requests ?? 0;
    u.cpuMs += (w.sum.cpuTimeUs ?? 0) / 1000;
  }
  for (const r of acct.r2ops ?? []) {
    const action = r.dimensions.actionType ?? '';
    if (R2_FREE.has(action)) continue;
    if (R2_CLASS_A.has(action)) u.r2ClassA += r.sum.requests ?? 0;
    else u.r2ClassB += r.sum.requests ?? 0;
  }
  let bytes = 0;
  for (const s of acct.r2store ?? []) bytes += (s.max.payloadSize ?? 0) + (s.max.metadataSize ?? 0);
  u.r2StorageGB = bytes / 1e9;
  for (const d of acct.d1 ?? []) {
    u.d1RowsRead += d.sum.rowsRead ?? 0;
    u.d1RowsWritten += d.sum.rowsWritten ?? 0;
  }
  for (const k of acct.kv ?? []) {
    const a = (k.dimensions.actionType ?? '').toLowerCase();
    const n = k.sum.requests ?? 0;
    if (a.includes('list')) u.kvLists += n;
    else if (a.includes('delete')) u.kvDeletes += n;
    else if (a.includes('write') || a.includes('put')) u.kvWrites += n;
    else u.kvReads += n;
  }
  return u;
}

export async function readUsage(env: Env, now: number, fetcher: Fetcher): Promise<{ usage: Usage; missing: string[] }> {
  const from = periodStart(now, Number(env.BILLING_DAY ?? 1) || 1).toISOString();
  const variables = { acct: env.CF_ACCOUNT_ID, from, to: new Date(now).toISOString() };
  const acct: GqlAccount = {};
  const missing: string[] = [];
  await Promise.all(
    (Object.keys(PARTS) as (keyof GqlAccount)[]).map(async (key) => {
      const query = `query Spend($acct: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: { accountTag: $acct }) { ${key}: ${PARTS[key]} } } }`;
      const res = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { viewer?: { accounts?: GqlAccount[] } }; errors?: { message: string }[] };
      const rows = body.data?.viewer?.accounts?.[0]?.[key];
      if (!res.ok || body.errors?.length || !rows) {
        missing.push(`${key} (${res.status}${body.errors?.length ? ': ' + body.errors.map((e) => e.message).join('; ') : ''})`);
        return;
      }
      (acct as Record<string, unknown>)[key] = rows;
    }),
  );
  if (REQUIRED.some((k) => !acct[k])) throw new Error(`analytics failed: ${missing.join(', ')}`);
  return { usage: usageFrom(acct), missing };
}

/** Detaches every custom domain from this Worker. `npx wrangler deploy` attaches api.darnly.dev again. */
async function takeOffline(env: Env, fetcher: Fetcher): Promise<number> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`;
  const headers = { authorization: `Bearer ${env.CF_API_TOKEN}` };
  const list = (await (await fetcher(`${base}?service=${encodeURIComponent(env.WORKER_NAME ?? 'darnly-cloud')}`, { headers })).json()) as {
    result?: { id: string; hostname: string; service: string }[];
  };
  const mine = (list.result ?? []).filter((d) => d.service === (env.WORKER_NAME ?? 'darnly-cloud'));
  for (const d of mine) await fetcher(`${base}/${d.id}`, { method: 'DELETE', headers });
  return mine.length;
}

export interface SpendResult {
  usd: number | null;
  action: 'none' | 'paused' | 'offline' | 'not_configured' | 'error';
  detail?: string;
  /** Datasets that couldn't be read this hour (their cost counts as 0). */
  missing?: string[];
}

export async function checkSpend(env: Env, now = Date.now(), fetcher: Fetcher = fetch): Promise<SpendResult> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { usd: null, action: 'not_configured' };
  let usd: number;
  let missing: string[];
  try {
    const read = await readUsage(env, now, fetcher);
    usd = estimateUsd(read.usage);
    missing = read.missing;
  } catch (e) {
    return { usd: null, action: 'error', detail: (e as Error).message };
  }
  const month = billingMonth(now, Number(env.BILLING_DAY ?? 1) || 1);
  await env.OAUTH_KV.put('spend:latest', JSON.stringify({ usd, month, at: new Date(now).toISOString(), missing }));
  const pauseAt = Number(env.SPEND_PAUSE_USD ?? 50);
  const stopAt = Number(env.SPEND_STOP_USD ?? 85);
  if (usd >= stopAt) {
    await env.OAUTH_KV.put(PAUSE_KEY, month);
    const n = await takeOffline(env, fetcher);
    return { usd, action: 'offline', detail: `detached ${n} domain(s)`, missing };
  }
  if (usd >= pauseAt) {
    await env.OAUTH_KV.put(PAUSE_KEY, month);
    return { usd, action: 'paused', missing };
  }
  return { usd, action: 'none', missing };
}
