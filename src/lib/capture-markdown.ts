import { DONE_FOLDER, INBOX_FOLDER } from '@/config/product';
import type { ElementInfo } from './element-info';
import { errorLines, requestLines, type LogEntry } from './logs';

export interface CaptureInput {
  id: string;
  note: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  browser: string;
  capturedAt: Date;
  /** Missing when the user pressed Esc to capture the whole page. */
  element?: ElementInfo;
  /** Errors and failed requests from the last 60 seconds, already redacted. */
  logs?: LogEntry[];
  /** False when the page recorder isn't switched on for this site. */
  recorder?: boolean;
  /** Written for pasting into a chat (cloud projects): no file paths the agent can't open. */
  forPaste?: boolean;
}

const STYLE_SUMMARY = ['display', 'visibility', 'opacity', 'pointer-events', 'position', 'z-index', 'width', 'height', 'color', 'background-color', 'font-size'];

/** Where the bug is, for the file's heading: the page path and the component or element. The note itself goes under "Expected". */
export function whereHeading(url: string, element?: ElementInfo): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep as is */
  }
  const what = element ? element.components?.at(-1) ?? element.component ?? `${element.tag}${element.text ? ` "${element.text.slice(0, 40)}${element.text.length > 40 ? '…' : ''}"` : ''}` : 'whole page';
  return `Bug on ${path}: ${what}`;
}

/** First line of the note, used for the file name and the bug list. */
export function headingFrom(note: string, element?: ElementInfo): string {
  const first = (note.split('\n')[0] ?? '').trim();
  if (first) return first; // never cut: a chopped heading reads like lost text
  return element ? `Problem with ${element.tag}${element.text ? ` "${element.text.slice(0, 40)}"` : ''}` : 'Problem on this page';
}

function yamlValue(v: string): string {
  return /^[\w./:@-]+$/.test(v) ? v : JSON.stringify(v);
}

/** The markdown file an agent reads: the intent first, then the facts. */
export function captureMarkdown(c: CaptureInput): string {
  const png = c.forPaste ? 'the screenshot pasted with this message' : `${INBOX_FOLDER}/${c.id}.png`;
  const lines = [
    '---',
    `id: ${c.id}`,
    `url: ${yamlValue(c.url)}`,
    `page_title: ${yamlValue(c.title)}`,
    `captured: ${c.capturedAt.toISOString()}`,
    `viewport: ${c.viewport.width}x${c.viewport.height}`,
    `browser: ${yamlValue(c.browser)}`,
    '---',
    `# ${whereHeading(c.url, c.element)}`,
    '',
    `**Expected:** ${c.note.trim() || '(no note given)'}`,
    '',
    `**Screenshot:** ${png}${c.element ? ' (the red box marks the element)' : ''}`,
    '',
  ];
  const el = c.element;
  if (el) {
    const styles = STYLE_SUMMARY.filter((k) => el.styles[k]).map((k) => `${k}: ${el.styles[k]}`).join('; ');
    lines.push(
      '## Element (the red box)',
      `- selector: \`${el.selector}\``,
      ...(el.text ? [`- text: "${el.text}"`] : []),
      ...(el.source ? [`- code: \`${el.source}\` (start here)`] : []),
      ...(el.components?.length ? [`- drawn by: ${el.components.map((n) => `\`${n}\``).join(' > ')}`] : el.component ? [`- component: ${el.component}`] : []),
      `- size: ${Math.round(el.rect.width)}x${Math.round(el.rect.height)} at (${Math.round(el.rect.x)}, ${Math.round(el.rect.y)})`,
      `- styles: ${styles}`,
      '',
      '```html',
      el.html,
      '```',
      '',
    );
    if (el.atCursor) {
      const a = el.atCursor;
      lines.push(
        '## Exactly under the cursor',
        `The red box is a large container. The user clicked on this element inside it (the dot on the screenshot), which is most likely the one they mean:`,
        `- selector: \`${a.selector}\``,
        ...(a.text ? [`- text: "${a.text}"`] : []),
        `- size: ${Math.round(a.rect.width)}x${Math.round(a.rect.height)} at (${Math.round(a.rect.x)}, ${Math.round(a.rect.y)})`,
        '',
        '```html',
        a.html,
        '```',
        '',
      );
    }
  } else {
    lines.push('Whole visible page captured (no single element picked).', '');
  }
  const hints = searchHints(c);
  if (hints.length) lines.push('## Where to look', ...hints, '');
  const logs = c.logs ?? [];
  const errors = errorLines(logs);
  const requests = requestLines(logs);
  if (errors.length) lines.push('## Errors (last 60s)', ...errors, '');
  if (requests.length) lines.push(c.recorder === false ? '## Failed requests (since the page loaded)' : '## Failed requests (last 60s)', ...requests, '');
  if (logs.length && c.recorder === false) lines.push('_Console errors are not recorded on this site (recording is off); failed requests come from the page\'s request history._', '');
  if (logs.length && !c.forPaste) lines.push(`Full logs: ${INBOX_FOLDER}/${c.id}.logs.json`, '');
  else if (c.recorder === false) lines.push('_No failed requests since the page loaded. Console errors are not recorded on this site (recording is off)._', '');
  else lines.push('No console errors or failed requests in the last 60 seconds.', '');
  lines.push(
    '## How to fix',
    'If the note is vague or compares to something else ("like the other pages", "like the Beliefs pills"), look at that part of the code first and match it. If it is still unclear, ask the user one short question before changing anything.',
    c.forPaste
      ? 'Find the code with the hints above and fix it so the expected behaviour happens.'
      : `Find the code with the hints above, fix it so the expected behaviour happens, then move this file and its PNG to ${DONE_FOLDER}/.`,
    '',
  );
  return lines.join('\n');
}

/** Things the agent can search for: the page route and short visible labels near the element. */
function searchHints(c: CaptureInput): string[] {
  const out: string[] = [];
  try {
    const u = new URL(c.url);
    if (u.pathname && u.pathname !== '/') out.push(`- page route: \`${u.pathname}\` (look for the route or page file with this path)`);
  } catch {
    /* not a URL */
  }
  const labels = [...(c.element?.atCursor?.labels ?? []), ...(c.element?.labels ?? [])].filter((l, i, a) => a.indexOf(l) === i).slice(0, 4);
  if (labels.length) out.push(`- text on screen to search the code for: ${labels.map((l) => `"${l}"`).join(', ')}`);
  return out;
}
