# Darnly cloud

The cloud inbox for projects whose code isn't on your computer. The extension uploads each bug here, and (from sprint A3) your coding agent reads it through MCP.

It's one Cloudflare Worker with D1 (the bug list) and R2 (pictures, reports and logs).

## Develop and test

```sh
cd cloud
npm install --legacy-peer-deps
npm test          # runs inside the Workers runtime, fully local
npm run typecheck
```

`npx wrangler dev` runs it locally. To sign in locally without Google, create `cloud/.dev.vars` with `ALLOW_DEV_LOGIN=true` and send `{"devEmail": "you@example.com"}` to `/v1/auth/google`. Never set `ALLOW_DEV_LOGIN` in production.

## API (all JSON, `Authorization: Bearer <token>` except sign-in)

| Call | What it does |
|---|---|
| `POST /v1/auth/google` `{accessToken}` | Trades a Google token (from the extension's OAuth client only) for a Darnly session token |
| `POST /v1/auth/logout` | Ends this session |
| `GET /v1/me`, `DELETE /v1/me` | Who am I; delete my account and everything in it |
| `POST /v1/bugs` (multipart: `meta`, `report`, `picture`, optional `logs`) | Saves a bug |
| `GET /v1/bugs?status=waiting\|fixed` | Lists my bugs, newest first |
| `GET /v1/bugs/:id`, `GET /v1/bugs/:id/picture` | One bug with its report and logs; its picture |
| `POST /v1/bugs/:id/fixed` `{note}` | Marks it fixed |
| `DELETE /v1/bugs` | Deletes all my bugs and their files |

Limits: 5 MB per picture, 120 bugs an hour, 500 waiting. Fixed bugs are deleted 30 days after they're fixed (daily cron).

## MCP for coding agents

Agents connect to `<PUBLIC_URL>/mcp` (production: `https://api.darnly.dev/mcp`). It's stateless Streamable HTTP with OAuth 2.1, using Cloudflare's `workers-oauth-provider`, with dynamic client registration at `/register`, so Claude, Claude Code and Cursor can add it as a connector by URL alone.

Sign-in: the agent opens `/authorize`, which shows "Connect <app> to Darnly?" with the app's name and redirect host. The user continues with Google, and the agent gets a token for that user's inbox only. The approval must come from the same browser that saw the page (a `__Host-` cookie), so a forged form post is refused.

Tools:

| Tool | What it does |
|---|---|
| `list_bugs` `{status?}` | Waiting bugs by default, newest first, with ids |
| `get_bug` `{id}` | The report (fenced page data) plus the screenshot as an image |
| `mark_fixed` `{id, note}` | Marks it fixed; the extension shows the note |

Deleting an account revokes every agent's access.

## Deploy (first time)

Deploy steps are written up in sprint A4.
