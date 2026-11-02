// Builds /llms.txt and /llms-full.txt (https://llmstxt.org) from the tool and guide lists at build time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES, STORE_URL, TOOLS, toolsByCategory, type Item } from './site';

const SITE = 'https://darnly.dev';

const INTRO = `# Darnly

> Darnly is a free Chrome extension and Mac app that turns a bug you see on screen into context for AI coding agents such as Claude Code, Codex and Cursor. Press one key, click the broken part, say what you expected: the agent gets a marked-up screenshot, the element, the file that drew it and recent errors.

- Chrome extension: press Option+Shift+B (Alt+Shift+B on Windows and Linux) on any page, localhost or live, click the broken element and type one sentence. Works in Chrome, Edge, Brave and Arc.
- What the agent gets: a screenshot with the element boxed in red, the element's selector, text, HTML and styles, the source file and component on a local project, and console errors and failed requests from the last 60 seconds.
- Where reports go: plain Markdown files in \`.darnly/inbox/\` inside the project, so any agent that reads files can fix them ("fix my bugs"). Cloud projects can copy the picture and details instead, or use the optional cloud inbox.
- Darnly for Mac: a menu bar app for Mac apps, the iOS Simulator and the Android Emulator, using macOS accessibility to find the element. Early access by email at hello@darnly.dev.
- Privacy: no account needed, nothing is sent to Darnly unless the optional cloud inbox is switched on, and passwords, tokens, API keys and cookies are replaced with [hidden] before anything is saved.
- Free tools: ${TOOLS.length} free, no-signup tools for people building websites with AI agents, most running entirely in the browser.`;

const LINKS = `## Darnly

- [Darnly home page](${SITE}/): what Darnly does and how it works
- [Darnly on the Chrome Web Store](${STORE_URL}): install the free extension
- [Darnly for Mac](${SITE}/#mac): the menu bar app for Mac, iOS Simulator and Android Emulator bugs
- [Privacy policy](${SITE}/privacy): what is captured, hidden and stored
- [All free tools](${SITE}/tools/): every tool, grouped by category`;

const OPTIONAL = `## Optional

- [Darnly on X](https://x.com/darnlyhq): product updates
- [Source on GitHub](https://github.com/maruthiram08/darnly.dev): the extension, Mac app and this website`;

const url = (base: string, slug: string) => `${SITE}/${base}/${slug}/`;

// The page's own intro (lede, else meta description), read from its source. Falls back to the list's blurb.
function pageText(dir: string, t: Item): string {
  let src = '';
  try {
    src = readFileSync(join(process.cwd(), 'src/pages', dir, t.slug, 'index.astro'), 'utf8');
  } catch {
    return t.blurb;
  }
  const attr = (name: string) => src.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]?.trim();
  return attr('lede') ?? attr('description') ?? t.blurb;
}

function sections(full: boolean): string[] {
  const line = (dir: string, t: Item) => `- [${t.name}](${url(dir, t.slug)}): ${full ? pageText(dir, t) : t.blurb}`;
  const out = toolsByCategory().map((g) => `## Free tools: ${g.name}\n\n${g.tools.map((t) => line('tools', t)).join('\n')}`);
  if (GUIDES.length > 0) out.push(`## Guides\n\n${GUIDES.map((g) => line('guides', g)).join('\n')}`);
  return out;
}

export const llmsTxt = () => [INTRO, LINKS, ...sections(false), OPTIONAL].join('\n\n') + '\n';
export const llmsFullTxt = () => [INTRO, LINKS, ...sections(true), OPTIONAL].join('\n\n') + '\n';

export const textResponse = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
