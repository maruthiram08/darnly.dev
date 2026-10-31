/**
 * The product name lives here and nowhere else.
 * When the final name is chosen, change NAME and SLUG; everything else follows.
 */
export const PRODUCT = {
  /** Shown to people: extension name, side panel title, store listing. */
  NAME: 'Darnly',
  /** Lowercase, no spaces: used for folders, skill names and marker comments. */
  SLUG: 'darnly',
} as const;

/** The folder inside the user's project, e.g. `.darnly/`. */
export const ROOT_FOLDER = `.${PRODUCT.SLUG}`;
export const INBOX_FOLDER = `${ROOT_FOLDER}/inbox`;
export const DONE_FOLDER = `${ROOT_FOLDER}/done`;

/** Marker comments around the block we add to AGENTS.md. */
export const AGENTS_MARKER_START = `<!-- ${PRODUCT.SLUG}:start -->`;
export const AGENTS_MARKER_END = `<!-- ${PRODUCT.SLUG}:end -->`;

/** Where the agent skill is written. */
export const SKILL_PATHS = [
  `.agents/skills/${PRODUCT.SLUG}/SKILL.md`,
  `.claude/skills/${PRODUCT.SLUG}/SKILL.md`,
] as const;
