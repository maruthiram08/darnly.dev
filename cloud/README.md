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

## Deploy (first time)

Deploy steps are written up in sprint A4.
