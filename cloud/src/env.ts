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
}
