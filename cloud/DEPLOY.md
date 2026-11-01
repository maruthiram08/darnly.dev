# Going live with the cloud inbox

About 20 minutes, once. Do it in this order. Steps 1 and 2 need the Chrome Web Store item id, which you can see in the Developer Dashboard (the long id in the item's URL).

## 1. Google sign-in (Google Cloud Console)

1. Open https://console.cloud.google.com, create a project called "Darnly".
2. **APIs & Services → OAuth consent screen:** External, app name Darnly, user support email: your own Gmail (Google only allows the signed-in account or a Google Group you own), developer contact: hello@darnly.dev, homepage https://darnly.dev, privacy policy the PRIVACY.md link. Scopes: `openid` and `email` only. Publish it.
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

The two Google client ids are already in `wrangler.jsonc`. Then (paste the Web client's secret when asked):

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
npm run zip   # the Chrome extension client id is built in (wxt.config.ts)
```

Upload the zip as version 0.2.0, with the changes in `store/listing-0.2.0.md`.

To try sign-in before the store approves 0.2.0, build an unpacked copy with the store's id: copy the public key from Developer Dashboard → Package → Public key, then run `DARNLY_MANIFEST_KEY=<key> npm run build` and load `.output/chrome-mv3`.

## 4. Try it

1. In the panel: "In the cloud", then Sign in with Google.
2. In Claude: Settings → Connectors → Add custom connector → `https://api.darnly.dev/mcp`. Approve on the Darnly page.
3. Capture a bug, then tell Claude "fix my Darnly bugs".

## 5. Spending limits (keep the month under $100)

Cloudflare has no setting that stops spending, so the Worker guards itself. What is automatic:

- **Caps** (always on): 200 cloud bugs a day and 1 GB stored per user; 20,000 bugs, 20 GB and 500 new sign-ups a day for everyone together. Deleting bugs doesn't reset the daily counts. Over a cap the extension says so and the bug can still be copied into the agent.
- **Per-IP rate limit** (always on): 20 uploads/sign-ins a minute and 300 requests a minute per address.
- **Spend meter** (once you add the token below): every hour it reads this billing month's usage for the whole Cloudflare account and prices it. At **$50** of usage, new uploads and new sign-ups stop until next month (reading and fixing bugs still work). At **$85**, it removes `api.darnly.dev` from the Worker, so no request reaches it and nothing more is billed. With the $5 plan and up to an hour of lag, the month stays under $100. The limits are `SPEND_PAUSE_USD` and `SPEND_STOP_USD` in `wrangler.jsonc`.

Set it up once (about 10 minutes):

1. Apply the new table and deploy:
   ```sh
   cd cloud
   npx wrangler d1 migrations apply darnly --remote
   npx wrangler deploy
   ```
2. Make an API token: Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, with these permissions:
   - Account → Account Analytics → Read
   - Account → Workers Scripts → Edit
   - Zone → Workers Routes → Edit (zone: darnly.dev)
3. Give it to the Worker, with your account id (Workers & Pages overview, right side):
   ```sh
   npx wrangler secret put CF_API_TOKEN
   npx wrangler secret put CF_ACCOUNT_ID
   ```
4. If your billing period doesn't start on the 1st (Manage Account → Billing → Billable Usage shows it), add a variable `BILLING_DAY` with that day, in the dashboard under darnly-cloud → Settings → Variables.
5. Check it after the next hour: `npx wrangler kv key get --remote --binding OAUTH_KV spend:latest` shows the last estimate. The Worker's logs show a `spend:` line each hour.

What is manual (only you can do these):

- **Budget alerts** as an early warning: Manage Account → Billing → Billable Usage → Create budget alert, at $25, $50 and $90. They only send email.
- **A WAF rate-limiting rule**, so floods are stopped before they reach the Worker (blocked requests aren't billed): darnly.dev zone → Security → WAF → Rate limiting rules → Create: hostname equals `api.darnly.dev`, 100 requests per 10 seconds per IP, action Block for 1 minute.
- **Turn uploads off by hand**: darnly-cloud → Settings → Variables → add `UPLOADS_OFF` = `true` → Deploy. Remove it to turn them back on.
- **Take everything offline by hand**: darnly-cloud → Settings → Domains & Routes → remove `api.darnly.dev`.

After the meter paused or stopped things, to turn them back on:

```sh
npx wrangler kv key delete --remote --binding OAUTH_KV config:paused   # uploads and sign-ups again
npx wrangler deploy                                                    # puts api.darnly.dev back
```

The pause ends by itself when the next billing month starts; the domain stays off until you deploy. Storage already saved keeps costing a little after a stop (about $0.015 per GB a month).
