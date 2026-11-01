export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** OAuth client id (type "Chrome extension") that extension tokens must be issued to. */
  GOOGLE_EXTENSION_CLIENT_ID: string;
  /** "true" only in local tests and `wrangler dev`: lets a made-up email sign in. Never set in production. */
  ALLOW_DEV_LOGIN?: string;
}
