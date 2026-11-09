/**
 * What the finder searches for. Built from the 200-keyword SEO list (Nov 2026):
 * Google phrasings like "visual bug capture for claude code" don't appear on Reddit,
 * so we combine the tool names from that list with the words people actually use
 * when a UI change goes wrong.
 *
 * Edit freely: one line per search. Reddit search supports quotes, OR and brackets.
 */
export const REDDIT_QUERIES: string[] = [
  // Agent + visual pain
  '"claude code" (css OR layout OR "ui bug" OR styling OR "wrong button" OR "wrong element")',
  '"claude code" (screenshot OR "show it" OR "point at" OR "which element")',
  'cursor (css OR layout OR "ui bug" OR styling) (broke OR broken OR wrong OR keeps)',
  'cursor (screenshot OR "which element" OR "wrong element" OR "wrong component")',
  'codex (css OR layout OR "ui bug" OR screenshot OR styling)',
  'windsurf (css OR layout OR "ui bug" OR screenshot)',
  '(lovable OR bolt OR v0) (layout OR css OR "ui bug" OR "looks broken" OR "mobile view")',
  '(lovable OR bolt OR v0) ("preview" OR "live site") (broken OR different OR wrong)',
  // Describing bugs to an agent
  '("ai agent" OR "coding agent" OR llm) ("ui bug" OR "visual bug" OR "css bug") (describe OR explain OR show)',
  '"describe the bug" (cursor OR "claude code" OR codex OR agent)',
  '("changed all" OR "changed every" OR "only this one") (button OR component OR cursor OR "claude code")',
  '("give it a screenshot" OR "paste a screenshot" OR "screenshot to") (cursor OR "claude code" OR codex)',
  '("console errors" OR "console log") (cursor OR "claude code" OR codex) (paste OR copy)',
  // Vibecoding workflow pain
  'vibecoding (bug OR bugs) (report OR track OR list OR fix)',
  'vibe coding ("ui bug" OR "visual bug" OR layout OR css)',
  '("bug report" OR "bug reporting") ("ai coding" OR "claude code" OR cursor OR vibecoding)',
  '("usage limit" OR "rate limit") ("claude code" OR cursor) (bugs OR "bug list" OR later)',
  '("design mode" OR "visual editor") (cursor OR "claude code")',
  // Comparisons people ask about
  '("marker.io" OR "jam.dev" OR "bugherd") (cursor OR "claude code" OR ai OR alternative)',
  '("chrome devtools mcp" OR "claude in chrome" OR "browser mcp") (bug OR css OR ui)',
];

/** Hacker News (Algolia) matches every word, with no OR. Keep these short. */
export const HN_QUERIES: string[] = [
  'claude code css',
  'claude code screenshot',
  'cursor ui bug',
  'cursor screenshot',
  'vibe coding bugs',
  'coding agent visual bug',
];

/**
 * Cheap check before we spend money on Claude: the post must name an AI coding tool
 * AND talk about something visual. Anything else is skipped without a Claude call.
 */
const TOOL_WORDS = /\b(claude code|claude|cursor|codex|windsurf|copilot|lovable|bolt|v0|replit|vibe ?cod(e|ing|er)|ai agent|coding agent|llm|chatgpt)\b/i;
const VISUAL_WORDS = /\b(ui|ux|css|tailwind|layout|styl(e|es|ing)|button|component|element|screenshot|visual|design|pixel|padding|margin|font|colou?r|mobile|responsive|frontend|front-end|page|modal|navbar|header|footer|looks?)\b/i;

export function worthJudging(text: string): boolean {
  return TOOL_WORDS.test(text) && VISUAL_WORDS.test(text);
}
