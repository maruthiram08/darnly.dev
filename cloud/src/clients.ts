import type { Env } from './env';

/** An agent that registered but never finished signing in is forgotten after this long. */
export const UNUSED_CLIENT_MS = 24 * 3_600_000;

/**
 * Daily job: delete agent registrations (OAuth dynamic client registration) that never got a token.
 * Anyone can call /register, so without this the KV store fills with clients nobody used.
 * A client "got a token" when it has a grant: grants are written when the user approves the sign-in.
 * Clients with a grant are kept; the OAuth library already expires idle ones after 90 days.
 */
export async function deleteUnusedClients(env: Env, now = Date.now()): Promise<number> {
  const used = new Set<string>();
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<{ clientId?: string }> = await env.OAUTH_KV.list<{ clientId?: string }>({ prefix: 'grant:', cursor });
    for (const key of page.keys) {
      let clientId = key.metadata?.clientId;
      if (typeof clientId !== 'string') clientId = (await env.OAUTH_KV.get<{ clientId?: string }>(key.name, 'json'))?.clientId;
      if (clientId) used.add(clientId);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  let deleted = 0;
  cursor = undefined;
  do {
    const page: KVNamespaceListResult<unknown> = await env.OAUTH_KV.list({ prefix: 'client:', cursor });
    for (const key of page.keys) {
      const clientId = key.name.slice('client:'.length);
      if (used.has(clientId)) continue;
      const client = await env.OAUTH_KV.get<{ registrationDate?: number }>(key.name, 'json');
      // Only dynamically registered clients carry registrationDate; leave anything else alone.
      if (!client?.registrationDate || now - client.registrationDate * 1000 < UNUSED_CLIENT_MS) continue;
      await env.OAUTH_KV.delete(key.name);
      deleted++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return deleted;
}
