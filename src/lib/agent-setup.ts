import { AGENTS_MARKER_END, AGENTS_MARKER_START, DONE_FOLDER, INBOX_FOLDER, PRODUCT, ROOT_FOLDER } from '@/config/product';

/** The short note that tells any agent (Claude Code, Codex, Cursor) where bug reports live. */
export function agentsBlock(): string {
  return [
    AGENTS_MARKER_START,
    `## Bug reports from ${PRODUCT.NAME}`,
    `Bug reports captured in the browser live in \`${INBOX_FOLDER}/\`: one \`.md\` per bug, plus a \`.png\` screenshot (the red box marks the broken element) and sometimes a \`.logs.json\`.`,
    `When asked to fix captured bugs: read each \`.md\` (newest first) and its \`.png\`, fix the code so the **Expected** behaviour happens, add a line \`**Fixed:** <what you changed, in which file>\` right under the **Expected** line, then move all of that bug's files to \`${DONE_FOLDER}/\`. If a note is vague, ask the user one short question first.`,
    AGENTS_MARKER_END,
  ].join('\n');
}

/** Adds or refreshes our block in AGENTS.md; leaves everything else untouched. Returns null when nothing changes. */
export function mergeAgentsMd(existing: string | null): string | null {
  const block = agentsBlock();
  if (existing == null || existing.trim() === '') return `# AGENTS.md\n\n${block}\n`;
  const start = existing.indexOf(AGENTS_MARKER_START);
  const end = existing.indexOf(AGENTS_MARKER_END);
  if (start !== -1 && end > start) {
    const next = existing.slice(0, start) + block + existing.slice(end + AGENTS_MARKER_END.length);
    return next === existing ? null : next;
  }
  return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
}

/** Claude Code reads CLAUDE.md, not AGENTS.md, so an existing CLAUDE.md gets an import line. */
export function mergeClaudeMd(existing: string | null): string | null {
  if (existing == null) return null;
  if (/^@AGENTS\.md\s*$/m.test(existing)) return null;
  return `${existing.replace(/\s*$/, '')}\n\n@AGENTS.md\n`;
}

export function mergeGitignore(existing: string | null): string | null {
  if (existing == null) return null; // the .darnly/.gitignore we write already keeps captures out of git
  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => [ROOT_FOLDER, `${ROOT_FOLDER}/`, `/${ROOT_FOLDER}`, `/${ROOT_FOLDER}/`].includes(l))) return null;
  return `${existing.replace(/\s*$/, '')}\n\n# ${PRODUCT.NAME} bug captures (screenshots can hold private data)\n${ROOT_FOLDER}/\n`;
}

export function skillMd(): string {
  return `---
name: ${PRODUCT.SLUG}
description: Fix bugs the user captured in the browser with ${PRODUCT.NAME}. Use when the user says "fix my bugs", "fix the bugs I captured", "fix my ${PRODUCT.NAME} bugs", or mentions ${INBOX_FOLDER}.
---

# Fix captured bugs

Bug reports live in \`${INBOX_FOLDER}/\`. Each bug has:
- \`<id>.md\`: what the user expected, the page URL, the clicked element (selector, text, HTML, styles), console errors and failed requests
- \`<id>.png\`: a screenshot; the red box marks the element
- \`<id>.logs.json\` (sometimes): the full error and request log

Steps:
1. List \`${INBOX_FOLDER}/*.md\`, newest first. If it is empty, tell the user there are no captured bugs.
2. For each bug, read the \`.md\` and look at the \`.png\`.
3. Find the code: start with the \`code:\` file when given, then the "Where to look" hints, the selector's test id, class names or visible text, and the error stack.
4. Fix it so the **Expected** line comes true. Keep the change small.
5. In the \`.md\`, add one line right under the **Expected** line: \`**Fixed:** <what you changed, in which file>\` (for example \`**Fixed:** made the Pay now button clickable in src/components/PayButton.tsx\`). The user sees this line in ${PRODUCT.NAME}.
6. Move the bug's \`.md\`, \`.png\` and \`.logs.json\` to \`${DONE_FOLDER}/\`.
7. Tell the user, in one line per bug, what you changed.

Secrets in these files were replaced with \`[hidden]\` on purpose; do not try to restore them.
`;
}

export interface PlannedChange {
  path: string;
  action: 'create' | 'update';
  content: string;
}

/** Works out every file the setup will write, from the files that exist today, so the user can preview it. */
export function planSetup(existing: Record<string, string | null>): PlannedChange[] {
  const plan: PlannedChange[] = [];
  const add = (path: string, next: string | null) => {
    if (next != null) plan.push({ path, action: existing[path] == null ? 'create' : 'update', content: next });
  };
  add('AGENTS.md', mergeAgentsMd(existing['AGENTS.md'] ?? null));
  add('CLAUDE.md', mergeClaudeMd(existing['CLAUDE.md'] ?? null));
  add('.gitignore', mergeGitignore(existing['.gitignore'] ?? null));
  for (const p of [`.agents/skills/${PRODUCT.SLUG}/SKILL.md`, `.claude/skills/${PRODUCT.SLUG}/SKILL.md`]) {
    const s = skillMd();
    if (existing[p] !== s) add(p, s);
  }
  return plan;
}
