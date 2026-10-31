# Chrome Web Store listing (copy and paste)

**Name:** Darnly

**Summary (132 characters max):**
Spot a bug, press a key, click it, say what you expected. Darnly writes the report your AI coding agent needs to fix it.

**Category:** Developer Tools

**Language:** English

**Description:**
Darnly turns a bug you see on screen into a report your AI coding agent can fix on the first try.

No more screenshot, switch apps, find the file, drag it in, explain it again.

How it works
1. Press the shortcut (Option+Shift+B on Mac, Alt+Shift+B on Windows).
2. Click the broken part of the page.
3. Type what you expected, and press Enter.

Darnly saves a report into your project that Claude Code, Codex and Cursor can read: a screenshot with the element marked, the element's code details, the file and component that drew it on localhost, recent console errors and failed requests, and your note. Then just tell your agent "fix my bugs".

Working on a cloud project? Copy the picture and the details and paste them into your agent's chat.

Private by default
- No account, no server. Nothing leaves your computer unless you paste it.
- Passwords, card numbers, tokens and API keys are hidden automatically.
- Works on localhost straight away; you switch on other sites one at a time.

Made for people who build with AI coding agents.

**Single purpose (for review):**
Capture a bug on the current web page (screenshot, element details, recent errors and a note) and save it as a report for the user's AI coding agent.

**Permission justifications (for review):**
- activeTab: take a screenshot and show the element picker on the tab where the user pressed the shortcut.
- scripting: inject the element picker into that tab on demand.
- sidePanel: the panel where the user types the note and sees saved bugs.
- storage: user settings and the linked project folder.
- offscreen: keep folder access alive between panel sessions.
- webRequest: notice failed requests on localhost and sites the user switched on.
- Host permissions (localhost) and optional host permissions: record console errors on localhost, and on other sites only after the user clicks "Record errors on this site" for that site.

**Remote code:** No, I am not using remote code.

**Data use disclosures:** tick Website content (screenshot, element text and HTML), User activity (console errors and failed requests on switched-on sites, the picking click) and Web history (address and title of the captured page). Leave the others unticked. Tick all three certifications. Darnly uses this only to create the bug report the user asked for, keeps it on the user's device, and does not sell or transfer it.

**Privacy policy URL:** https://github.com/maruthiram08/darnly.dev/blob/main/PRIVACY.md

**Visibility:** Unlisted (for testers first)

**Screenshots needed (1280x800, at least 1):** take these on your own machine:
1. The picker highlighting a broken button on a page.
2. The side panel with the note box and the marked screenshot.
3. A saved bug report open in Claude Code.

**Icon:** 128x128 is inside the zip (public/icon/128.png).
