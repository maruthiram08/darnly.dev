/**
 * Hides secrets before anything is written. Runs in the walled-off picker, never in the page.
 * Rules from the MVP architecture: token-like strings, secret-named query values, auth headers (never recorded).
 */
export const HIDDEN = '[hidden]';

const SECRET_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g, // Stripe, OpenAI, Anthropic style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex
  /\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{40,}={0,2}/g, // long random token (no '/', so URL paths survive)
];

const SECRET_NAME = /token|key|secret|session|^code$|password|passwd|pwd|auth|sig(nature)?|credential|otp|jwt|apikey/i;

export function redactText(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, HIDDEN);
  // name=value or "name": "value" pairs with secret-looking names
  out = out.replace(
    /(["']?)([A-Za-z_][\w-]*)\1(\s*[:=]\s*)(["']?)([^"'\s&,;}]{4,})\4/g,
    (m, q, name, sep, vq) => (SECRET_NAME.test(name) ? `${q}${name}${q}${sep}${vq}${HIDDEN}${vq}` : m),
  );
  return out;
}

/** Hides query values with secret-looking names, and token-like path parts. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const [k] of Array.from(u.searchParams)) if (SECRET_NAME.test(k)) u.searchParams.set(k, HIDDEN);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    if (u.hash.length > 20 && /access_token|id_token|token/i.test(u.hash)) u.hash = '#' + HIDDEN;
    return redactText(u.toString().replace(/%5Bhidden%5D/g, HIDDEN));
  } catch {
    return redactText(url);
  }
}
