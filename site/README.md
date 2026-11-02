# darnly.dev website

Built with [Astro](https://astro.build): plain static pages, one shared layout.

## Where things are

- `src/pages/index.astro`: the home page (sells bug capture). Its styles are in `src/styles/home.css`.
- `src/pages/tools/` and `src/pages/guides/`: the free tools and guides. Each hub lists what's in `src/data/site.ts` and stays hidden from search (noindex, not in the sitemap) until it lists something.
- `src/layouts/Base.astro`: every page's `<head>` (title, description, social preview, canonical URL, fonts).
- `src/components/SiteHeader.astro` and `SiteFooter.astro`: the top bar for inner pages and the footer for every page.
- `src/data/site.ts`: the Chrome Web Store link (tagged per page with `utm_source`) and the lists of tools and guides.
- `public/`: copied as is: `_headers` (security headers), `icon.png`, `robots.txt`, `privacy.html` (kept at its old address because the store listing links to it).

## Add a tool

1. Add it to `TOOLS` in `src/data/site.ts`.
2. Create `src/pages/tools/<slug>/index.astro`. The footer and `/tools/` pick it up automatically.

## Run it locally

```
cd site
npm install
npm run dev
```

## Deploy

Pushing to `main` deploys through the Cloudflare Worker `darnly-dev`. `wrangler.jsonc` at the repo root runs `npm ci` and `npm run build` in `site/` first, then uploads `site/dist`. The Node version comes from `.node-version` at the repo root.

After a deploy that adds or changes pages, run `npm run indexnow` in `site/` to tell Bing and other IndexNow search engines (add `-- --dry-run` to only list the URLs).
It sends every URL in the sitemap (from `dist/` if built, otherwise the live one) with the key in `public/81482878266902640d1cb34de558b363.txt`.
It is never part of the build or deploy, so a failure there can't break the site.

`/llms.txt` and `/llms-full.txt` are built from `src/data/site.ts` by `src/data/llms.ts`. Cloudflare Web Analytics turns on when a token is pasted into `src/data/analytics.ts`.
