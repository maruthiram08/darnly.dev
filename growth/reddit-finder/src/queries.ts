/**
 * What the finder searches for. Built from the 200-keyword SEO list (Nov 2026):
 * Google phrasings like "visual bug capture for claude code" don't appear on Reddit,
 * so we combine the tool names from that list with the words people actually use
 * when a UI change goes wrong.
 *
 * Most searches run inside the AI coding communities (AI_SUBS), where every post is
 * already about an agent, so they only need the visual or bug words. A few run across
 * all of Reddit and name the tool themselves.
 *
 * Edit freely: one line per search. Reddit search supports quotes, OR and brackets.
 */
export interface RedditSearch {
  q: string;
  /** Search only these communities ("A+B+C"). Left out = all of Reddit. */
  subs?: string;
}

/** Communities where nearly every post is about building with an AI coding tool. */
export const AI_SUBS = ['ClaudeAI', 'ClaudeCode', 'cursor', 'vibecoding', 'lovable', 'ChatGPTCoding', 'replit'];
const IN_AI = AI_SUBS.join('+');

export const REDDIT_QUERIES: RedditSearch[] = [
  // Inside the AI coding communities: visual and UI pain
  { subs: IN_AI, q: '"ui bug" OR "visual bug" OR "ui issues" OR "ui problems" OR "css bug"' },
  { subs: IN_AI, q: '(css OR layout OR styling OR tailwind) (broke OR broken OR wrong OR messed OR keeps OR ignores)' },
  { subs: IN_AI, q: 'screenshot OR screenshots OR "which element" OR "wrong element" OR "wrong component"' },
  { subs: IN_AI, q: '(frontend OR "front end" OR design OR ui) (ugly OR wrong OR fix OR tweak OR tweaks OR polish)' },
  { subs: IN_AI, q: '(button OR navbar OR modal OR padding OR spacing OR alignment OR font) (wrong OR off OR fix OR broke)' },
  { subs: IN_AI, q: '(mobile OR responsive) (broken OR wrong OR off OR overflow OR "looks bad")' },
  { subs: IN_AI, q: '("changed all" OR "changed every" OR "every button" OR "only this one" OR "only that one")' },
  { subs: IN_AI, q: '(describe OR explain OR "point at" OR "show it" OR "tell it") (ui OR bug OR element OR layout)' },
  { subs: IN_AI, q: '("bug report" OR "bug list" OR "track bugs" OR "keep track" OR backlog) (bugs OR ui OR fixes)' },
  { subs: IN_AI, q: '(testing OR qa OR "click through" OR "test manually") (app OR ui OR bugs)' },
  { subs: IN_AI, q: '("console errors" OR "console log" OR devtools OR inspect) (paste OR copy OR screenshot OR element)' },
  { subs: IN_AI, q: '("chrome devtools mcp" OR "claude in chrome" OR "browser mcp" OR playwright OR puppeteer) (ui OR css OR bug OR visual)' },
  // All of Reddit: the post names the tool itself
  { q: '"claude code" (css OR layout OR "ui bug" OR styling OR screenshot OR "wrong element")' },
  { q: 'cursor (css OR layout OR "ui bug" OR styling OR screenshot) (broke OR broken OR wrong OR keeps)' },
  { q: '(codex OR windsurf OR copilot) (css OR layout OR "ui bug" OR screenshot OR styling)' },
  { q: '(lovable OR bolt OR v0) (layout OR css OR "ui bug" OR "looks broken" OR "mobile view" OR preview)' },
  { q: '(vibecoding OR "vibe coding" OR vibecoded) ("ui bug" OR "visual bug" OR layout OR css OR bugs)' },
  { q: '("marker.io" OR "jam.dev" OR bugherd OR "bug reporting tool") (cursor OR "claude code" OR ai OR alternative)' },
];

/** Hacker News (Algolia) matches every word, with no OR. Keep these short. */
export const HN_QUERIES: string[] = [
  'claude code css',
  'claude code screenshot',
  'claude code frontend',
  'cursor ui bug',
  'cursor screenshot',
  'vibe coding bugs',
  'coding agent visual bug',
  'agent ui feedback',
];

/**
 * Cheap check before we spend money on Claude: the post must name an AI coding tool
 * (or be in one of the AI coding communities) AND talk about something visual. Anything else is skipped without a Claude call.
 */
const TOOL_WORDS = /\b(claude code|claude|cursor|codex|windsurf|copilot|lovable|bolt|v0|replit|vibe ?cod(e|ing|er)|ai agent|coding agent|llm|chatgpt)\b/i;
const VISUAL_WORDS = /\b(ui|ux|css|tailwind|layout|styl(e|es|ing)|button|component|element|screenshot|visual|design|pixel|padding|margin|font|colou?r|mobile|responsive|frontend|front-end|page|modal|navbar|header|footer|looks?|bugs?|qa)\b/i;

export function worthJudging(text: string, community = ''): boolean {
  const inAiSub = AI_SUBS.some((s) => s.toLowerCase() === community.toLowerCase());
  return (inAiSub || TOOL_WORDS.test(text)) && VISUAL_WORDS.test(text);
}
