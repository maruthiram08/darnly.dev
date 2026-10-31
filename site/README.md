# darnly.dev landing page

One static page: `index.html` plus two images. No build step.

## Put it live on Cloudflare Pages (about 5 minutes)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the `darnly.dev` repo, branch `main`.
3. Framework preset: **None**. Build command: leave empty. Build output directory: `site`.
4. **Save and Deploy**.
5. In the new project → **Custom domains** → **Set up a custom domain** → `darnly.dev` (and `www.darnly.dev`). Cloudflare adds the DNS records itself because the domain is already on Cloudflare.

Every push to `main` that changes `site/` redeploys it.
