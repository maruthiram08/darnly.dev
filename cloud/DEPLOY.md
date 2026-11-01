# Going live with the cloud inbox

About 20 minutes, once. Do it in this order. Steps 1 and 2 need the Chrome Web Store item id, which you can see in the Developer Dashboard (the long id in the item's URL).

## 1. Google sign-in (Google Cloud Console)

1. Open https://console.cloud.google.com, create a project called "Darnly".
2. **APIs & Services → OAuth consent screen:** External, app name Darnly, support email hello@darnly.dev, homepage https://darnly.dev, privacy policy the PRIVACY.md link. Scopes: `openid` and `email` only. Publish it.
3. **Credentials → Create credentials → OAuth client ID → Chrome extension.** Item ID: the store item id. Copy the client id: this is `DARNLY_GOOGLE_CLIENT_ID` (extension build) and `GOOGLE_EXTENSION_CLIENT_ID` (cloud).
4. **Create credentials → OAuth client ID → Web application.** Authorized redirect URI: `https://api.darnly.dev/oauth/google/callback`. Copy its client id (`GOOGLE_WEB_CLIENT_ID`) and secret (`GOOGLE_WEB_CLIENT_SECRET`).

## 2. Cloudflare

You need the Workers Paid plan ($5/month) for the database, storage and daily cleanup. Then, from the repo:

```sh
cd cloud
npm install --legacy-peer-deps
npx wrangler login
npx wrangler d1 create darnly            # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create darnly-bugs
npx wrangler kv namespace create OAUTH_KV   # paste the id into wrangler.jsonc
```

In `wrangler.jsonc`, fill in `GOOGLE_EXTENSION_CLIENT_ID` and `GOOGLE_WEB_CLIENT_ID`. Then:

```sh
npx wrangler secret put GOOGLE_WEB_CLIENT_SECRET
npx wrangler d1 migrations apply darnly --remote
npx wrangler deploy
```

Finally, in the Cloudflare dashboard: **Workers & Pages → darnly-cloud → Settings → Domains & Routes → Add → Custom domain → `api.darnly.dev`.**

Check: https://api.darnly.dev/v1/health should say `{"ok":true,...}`.

Never set `ALLOW_DEV_LOGIN` in production.

## 3. Extension build

```sh
DARNLY_GOOGLE_CLIENT_ID=<the Chrome extension client id> npm run zip
```

Upload the zip as version 0.2.0, with the changes in `store/listing-0.2.0.md`.

To try sign-in before the store approves 0.2.0, build an unpacked copy with the store's id: copy the public key from Developer Dashboard → Package → Public key, then run `DARNLY_MANIFEST_KEY=<key> DARNLY_GOOGLE_CLIENT_ID=<id> npm run build` and load `.output/chrome-mv3`.

## 4. Try it

1. In the panel: "In the cloud", then Sign in with Google.
2. In Claude: Settings → Connectors → Add custom connector → `https://api.darnly.dev/mcp`. Approve on the Darnly page.
3. Capture a bug, then tell Claude "fix my Darnly bugs".
