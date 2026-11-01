export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Grants and tokens for agents (MCP connectors), kept by the OAuth library, plus our short sign-in transactions. */
  OAUTH_KV: KVNamespace;
  /** Public address of this Worker, e.g. https://api.darnly.dev. Agents connect to <PUBLIC_URL>/mcp. */
  PUBLIC_URL?: string;
  /** OAuth client id (type "Chrome extension") that extension tokens must be issued to. */
  GOOGLE_EXTENSION_CLIENT_ID: string;
  /** OAuth client (type "Web application") used when an agent connects: Google sends the user back to /oauth/google/callback. */
  GOOGLE_WEB_CLIENT_ID?: string;
  /** Secret for that client. Set with `wrangler secret put GOOGLE_WEB_CLIENT_SECRET`, never in a file. */
  GOOGLE_WEB_CLIENT_SECRET?: string;
  /** "true" only in local tests and `wrangler dev`: lets a made-up email sign in. Never set in production. */
  ALLOW_DEV_LOGIN?: string;
  /** "true" turns cloud uploads and new sign-ups off. Set in the dashboard (Settings > Variables) to stop them in a minute. */
  UPLOADS_OFF?: string;
  /** Per-IP rate limits (Cloudflare rate limiting binding). Missing in tests. */
  WRITE_LIMITER?: RateLimit;
  ANY_LIMITER?: RateLimit;
  /** Spend meter (spend.ts). The account id and an API token with Account Analytics Read + Workers Scripts Edit, both set as secrets. */
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  /** Dollar amounts of usage this billing month at which uploads pause, and at which api.darnly.dev is taken offline. */
  SPEND_PAUSE_USD?: string;
  SPEND_STOP_USD?: string;
  /** Day of the month the Cloudflare billing period starts on (Billing > Billable Usage). Default 1. */
  BILLING_DAY?: string;
  WORKER_NAME?: string;
}
