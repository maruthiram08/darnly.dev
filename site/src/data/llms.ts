// Builds /llms.txt and /llms-full.txt (https://llmstxt.org) from the tool and guide lists at build time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES, STORE_URL, TOOLS, toolsByCategory, type Item } from './site';

const SITE = 'https://darnly.dev';

const INTRO = `# Darnly

> Darnly is a free Chrome extension and Mac app that turns a bug you see on screen into context for AI coding agents such as Claude Code, Codex and Cursor. Press one key, click the broken part, say what you expected: the agent gets a marked-up screenshot, the element, the file that drew it and recent errors.

- Chrome extension: press Option+Shift+B on a Mac on any page (Windows is coming soon), localhost or live, click the broken element and type one sentence. Works in Chrome, Edge, Brave and Arc.
- What the agent gets: a screenshot with the element boxed in red, the element's selector, text, HTML and styles, the source file and component on a local project, and console errors and failed requests from the last 60 seconds.
- Where reports go: plain Markdown files in \`.darnly/inbox/\` inside the project, so any agent that reads files can fix them. Setup adds a /darnly command (Claude Code skill, Cursor command; in Codex say "fix my bugs") that fixes the folder and cloud inbox in one go, and a Claude Code hook that tells the agent when bugs are waiting. Cloud projects can copy the picture and details instead, or use the optional cloud inbox, which agents read through Darnly's remote MCP server at https://api.darnly.dev/mcp (OAuth with Google sign-in; tools list_bugs, get_bug, ask_user, mark_fixed). Setup for Claude Code, Cursor and Codex: https://darnly.dev/setup/
- Closing the loop: when the agent fixes a bug it writes one line on what changed, and the Darnly panel shows "N bugs fixed. Take a look." even if it was closed meanwhile. If the agent needs to ask something, the panel shows "Your agent is waiting for your input. Return to your agent."
- Darnly for Mac: a menu bar app for Mac apps, the iOS Simulator and the Android Emulator, using macOS accessibility to find the element. Early access by email at hello@darnly.dev.
- Privacy: no account needed, nothing is sent to Darnly unless the optional cloud inbox is switched on, and passwords, tokens, API keys and cookies are replaced with [hidden] before anything is saved.
- Free tools: ${TOOLS.length} free, no-signup tools for people building websites with AI agents, most running entirely in the browser.`;

const LINKS = `## Darnly

- [Darnly home page](${SITE}/): what Darnly does and how it works
- [Darnly on the Chrome Web Store](${STORE_URL}): install the free extension
- [Darnly for Mac](${SITE}/#mac): the menu bar app for Mac, iOS Simulator and Android Emulator bugs
- [Privacy policy](${SITE}/privacy): what is captured, hidden and stored
- [Set up Darnly with Claude Code, Cursor or Codex](${SITE}/setup/): with or without MCP; a copy-paste prompt that makes the agent add the Darnly MCP server (https://api.darnly.dev/mcp) and the project note
- [What is Darnly](${SITE}/what-is-darnly/): short answers about what Darnly is, who it is for, price, agents and privacy
- [What's new in Darnly](${SITE}/changelog/): release notes, newest first (0.3.0: /darnly, agent questions in the panel, 'Take a look' when a bug is fixed)
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
