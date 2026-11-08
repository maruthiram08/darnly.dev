// Questions people ask search engines and AI assistants, answered in plain words.
// Shown on the homepage (with FAQPage schema) and in /llms.txt.
export const HOME_FAQ: { q: string; a: string }[] = [
  { q: 'How do I give UI feedback to Claude Code, Cursor or Codex?', a: 'Show the agent the bug, not a description of it: a screenshot with the broken part marked, the page address, the element, and what you expected. With Darnly you press Option+Shift+B, click the broken part and type what you expected. Your agent reads that report from your project folder, or from the Darnly cloud inbox, and fixes it when you type /darnly (in Codex, say "fix my Darnly bugs").' },
  { q: 'How is Darnly different from a screenshot annotation tool?', a: 'Annotation tools help you write one prompt that you paste into your agent. Darnly keeps a list of bugs that your agent works through. It fixes each one, writes a line on what changed, and the Darnly panel tells you what to check.' },
  { q: 'Does Darnly work on localhost and on pages behind a login?', a: 'Yes. Darnly runs in your own browser, so it captures whatever you can see, including localhost and pages you are signed in to. Console errors are recorded on localhost by default, and on a live site once you switch it on for that site.' },
  { q: 'Does Darnly send my data anywhere?', a: 'Not by default. Reports are files in your project, or text you choose to paste. Only the optional cloud inbox sends bugs to Darnly, into your private inbox. Passwords, card numbers, tokens, API keys and cookies are replaced with [hidden] before anything is saved.' },
  { q: 'Can I use Darnly in the Claude app?', a: 'Yes. Darnly is in Claude\u2019s connector directory: in Claude, open Settings, then Connectors, search for Darnly and click Connect. Then say "fix my Darnly bugs".' },
  { q: 'Is Darnly free?', a: 'Yes. The Chrome extension, the Mac app and the cloud inbox are free.' },
];
