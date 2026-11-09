// Cloudflare Web Analytics. Paste the site token from the Cloudflare dashboard
// (Analytics & Logs > Web Analytics > darnly.dev > Manage site > JS snippet, the "token" value).
// Left empty, no analytics script is added to any page.
export const CF_ANALYTICS_TOKEN = '';

// PostHog (src/components/PostHog.astro). Paste the project API key (starts with phc_) from
// PostHog > Settings > Project > Project API key. It is a public key, safe to commit.
// Left empty, PostHog is not added to any page and /ingest/* returns 404.
export const POSTHOG_KEY = 'phc_yM5hLbZaCmQPAuuvYR9oPhbzKS34HBDFezMv5HuHpmjh';
// The region the PostHog project was made in: 'us' (us.posthog.com) or 'eu' (eu.posthog.com).
export const POSTHOG_REGION: 'us' | 'eu' = 'us';
