# Darnly thread finder

A small private tool that finds Reddit and Hacker News posts where someone is stuck on a UI bug with an AI coding agent, and drafts a helpful reply for you to post yourself.

- Every hour it runs 5 of its 20 Reddit searches (they take turns, so each runs every 4 hours) and 6 Hacker News searches (edit them in `src/queries.ts`).
- A cheap word check drops posts that don't name an AI coding tool **and** something visual, so they never cost a Claude call.
- Claude scores each remaining post from 0 to 10 and, for a fit of 5 or more, drafts a reply under 90 words. The reply answers the question first and names Darnly only when it truly helps, always as "I built a free tool for this".
- You see them on a private page: **To reply** (fit 6+), **Maybe** (fit 4-5) and **Done**. Copy the draft, edit it, post it from your own account, then press **I replied**.
- **It never posts anything.** It only reads public search results.

## What it costs

- Cloudflare: nothing extra (one Worker, one small D1 database, one hourly cron).
- Claude: Claude looks at no more than 6 posts per hour and 30 per day (`MAX_JUDGE_PER_RUN` and `MAX_JUDGE_PER_DAY` in `wrangler.jsonc`). On Claude Opus 5.5 that's roughly 1 to 2 cents a post, so at most about $13 a month, and usually less. To spend less, set `MODEL` to `claude-haiku-5-5`, which costs well under $1 a month.
- Set a monthly spend limit in the Claude Console as well (step 5), so the bill can never surprise you.

## Set it up (about 15 minutes, on your Mac)

You do this once. Each step says what you should see.

### 1. Open the folder

Open Terminal and run:

```
cd ~/path/to/darnly.dev
git checkout main && git pull
cd growth/reddit-finder
npm install
```

Replace `~/path/to/darnly.dev` with where the repo is on your Mac (the same folder you use for `cloud/`).

**Success:** npm finishes with "added ... packages". Warnings are fine.

### 2. Sign in to Cloudflare

```
npx wrangler whoami
```

**Success:** it shows your email and account. If it says you're not logged in, run `npx wrangler login`, press **Allow** in the browser tab that opens, and run `whoami` again.

### 3. Create the database

```
npx wrangler d1 create darnly-thread-finder
```

**Success:** it prints a block that includes `"database_id": "..."` (a long id with dashes).

Open `growth/reddit-finder/wrangler.jsonc` in any editor, find `PASTE-DATABASE-ID-HERE` and replace it with that id (keep the quotes). Save.

While the file is open, put your Reddit username (without `u/`) between the quotes of `"REDDIT_USERNAME": ""`, so your own posts are skipped. Save.

Then create the tables:

```
npx wrangler d1 migrations apply darnly-thread-finder --remote
```

Type `y` when it asks. **Success:** a table with `0001_init.sql` and a ✅.

### 4. Choose an inbox password

```
npx wrangler secret put INBOX_KEY
```

It will ask whether to create the Worker: type `y`. Then type a long password you'll remember (it doesn't show while you type) and press Enter.

**Success:** "Success! Uploaded secret INBOX_KEY".

### 5. Add a Claude API key

1. Go to https://console.anthropic.com, sign in, and set a monthly spend limit (for example $15) on the **Limits** page under Settings.
2. Open **API keys**, click **Create key**, name it `darnly-thread-finder` and copy it.
3. In Terminal:

```
npx wrangler secret put ANTHROPIC_API_KEY
```

Paste the key and press Enter. **Success:** "Success! Uploaded secret ANTHROPIC_API_KEY".

### 6. Deploy

```
npx wrangler deploy
```

**Success:** the last lines show a web address like `https://darnly-thread-finder.<your-name>.workers.dev` and `schedule: 23 * * * *`.

### 7. Try it

1. Open that address, type your inbox password, and press **Open inbox**.
2. Press **Search now**, wait a minute, then refresh the page.
3. Look at the pills at the top:
   - **Reddit: working** and **Hacker News: working** mean the searches ran.
   - **Claude: N/30 posts checked today** means Claude is scoring posts.

Posts appear under **To reply** when Claude finds a good fit. On a quiet day that may be zero, which is normal. Check **Maybe** too.

## If something fails

- **Page says "Set the inbox key first"**: step 4 didn't finish. Run it again, then `npx wrangler deploy`.
- **Claude: no API key yet**: run step 5 again, then `npx wrangler deploy`.
- **Claude: failing (This API key is not scoped to a workspace…)**: your key belongs to the whole organization, so Claude needs to know which workspace to bill. In the Claude Console open **Settings > Workspaces**, copy the workspace id (it starts with `wrkspc_`), then run `npx wrangler secret put ANTHROPIC_WORKSPACE_ID` and paste it. No redeploy needed; click **Search now** again.
- **Reddit: failing (Reddit answered 429)**: Reddit allows only a few searches a minute without an API app. Each run makes 5 of the 20 searches in turn (`REDDIT_SEARCHES_PER_RUN`), so wait a few minutes before clicking **Search now** again. If it keeps failing, add a Reddit API app as described below.
- **Reddit: failing (Reddit answered 403)**: Reddit sometimes blocks requests from Cloudflare's servers. Hacker News keeps working. To fix Reddit, give the finder its own Reddit API app:
  1. Signed in to Reddit, go to https://www.reddit.com/prefs/apps and click **create another app**.
  2. Name `darnly-thread-finder`, choose **script**, redirect uri `http://localhost`, then **create app**. (If Reddit asks you to register for API access first, fill in its form: personal, non-commercial, read-only search.)
  3. The id under the app name is the client id; the **secret** is shown below it.
  4. Run `npx wrangler secret put REDDIT_CLIENT_ID` and paste the id, then `npx wrangler secret put REDDIT_CLIENT_SECRET` and paste the secret. No redeploy needed; the next hourly run uses them.
- **Anything else**: in the Cloudflare dashboard open **Workers & Pages > darnly-thread-finder > Logs**, or run `npx wrangler tail` in this folder and press **Search now**.

## Changing it

- Searches: `src/queries.ts`. One line per Reddit search; quotes, OR and brackets work.
- What Claude knows about Darnly and how it writes: `SYSTEM` in `src/judge.ts`. Keep it in step with darnly.dev/llms.txt.
- Spend caps and model: `vars` in `wrangler.jsonc`.

After a change, run `npm test`, then `npx wrangler deploy`.
