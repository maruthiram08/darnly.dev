# Darnly privacy policy

Last updated: 8 November 2026

Darnly is a Chrome extension and a Mac app that turn a bug you see on screen into a report your AI coding agent can read. This policy explains what it touches and where that goes.

## The short version

By default Darnly has no account and sends nothing to us. Every report stays on your computer until you choose to paste or share it.

From version 0.2.0 there is one exception, and only if you turn it on: the **cloud inbox**, for projects whose code isn't on your computer. If you sign in to it, each bug you capture is sent to your private Darnly inbox so your coding agent can read it. The section "The cloud inbox" below explains exactly what that means.

## What Darnly reads, and only when you capture

When you press the Darnly shortcut and click part of a page, Darnly reads:

- a screenshot of the visible page;
- details about the element you clicked: its text, HTML, styles, size and position, and its React component name and source file when the page exposes them;
- the page address and title;
- console errors and failed network requests from about the last 60 seconds, on localhost and on sites you switch recording on for. On other sites, only failed requests the browser already lists for the page;
- the **shape** of the data behind the element you clicked, on localhost and on sites you switch recording on for (see "The data behind this element" below);
- the note you type;
- the steps that led to the bug (see below).

Darnly does not read pages you do not capture. On localhost, and on sites you switch on, a small recorder keeps the last 60 seconds of errors, and the last 20 data (JSON) responses the page loaded, in the page's memory, so they are ready if you capture. It also keeps your last few actions there (for example "clicked button Save", "typed in field Email", "opened /settings"). That memory is never saved, is cleared when you close the tab, and never leaves the page unless you capture.

## The data behind this element

Some bugs only happen with your real data: an old record missing a field, a very long name, a list with 400 items. So when you capture, Darnly looks through the page's recent data responses for the record that filled the element you clicked, and adds a description of its **shape** to the report.

The shape is field names and what kind of value each one holds, never the values themselves. For example: `name: <text, 61 chars>`, `email: <email>`, `plan: null`, `tasks: <list, 412 items>`, `created_at: <date, 14 months ago>`. Real values stay in your browser. The only values kept are the record's id (so your agent can find it), true/false, zero, and short status-like words under fields such as `status` or `plan` (for example `active` or `pro`). Fields with secret-looking names (tokens, passwords, keys) are left out entirely.

This happens on your computer, needs nothing from you, and only on localhost and sites you switched recording on for. The shape is part of the report, so it goes wherever the report goes (your project folder, your clipboard, or your cloud inbox).

## Steps that led to the bug

Reports can list what you did before the bug, so your agent can repeat it:

- **Automatically**, on localhost and sites you switch recording on for: your last 10 actions from the last 5 minutes, kept in the page's memory.
- **When you press "Record the steps first"** in the Darnly panel: every action in that tab until you capture the bug or stop, each with a small screenshot of the screen just after it. The list lives in the browser's memory for that session and is thrown away when you stop, capture or close the tab. On a site other than localhost, Chrome first asks you to allow Darnly on that site, so recording can carry on when the page reloads; you can remove that in Chrome's extension settings at any time.

A step says what you clicked, which field you typed in, which option you chose and which page you opened. **Darnly never records what you type**, only where. A step's screenshot shows the screen like the main screenshot does; a step is left without a screenshot while a card number field on the page is filled in.

## What Darnly hides

Before anything is saved, Darnly removes things that look like secrets: passwords and card numbers (also blurred in the screenshot), auth headers, cookies, request and response bodies beyond a short error snippet, tokens, API keys, email addresses and secret-looking query parameters. These are replaced with `[hidden]`. Data responses are never copied into the report: only the shape of one record, as described above.

## Where reports go

- **Into your project folder**, if you link one. Reports are written to a `.darnly/` folder inside it, which Darnly also adds to `.gitignore` so it isn't committed.
- **Onto your clipboard**, if you click a copy button. You decide where to paste it.

- **Into your Darnly cloud inbox**, only if you chose "My code is in the cloud" and signed in (version 0.2.0 and later).

Darnly keeps the link to your project folder, your settings and (if you use the cloud inbox) your sign-in, in Chrome's own storage on your computer.

## The cloud inbox (optional, version 0.2.0 and later)

**What is sent:** for each bug you capture while signed in, the report (the same text you would otherwise save or paste, including the data shape described above, never data values), the marked screenshot, and the recent errors, all after the secrets above have been removed on your computer. Also your Google account's email address and Google's account id, to know whose inbox it is.

**Where it lives:** on Cloudflare, which runs Darnly cloud for us (a database for the bug list, file storage for screenshots and reports). Data is encrypted at rest by Cloudflare.

**Who can see it:** only you, and the coding agents you connect yourself. To connect an agent, you add Darnly as a connector in that agent and approve it on a Darnly page that names the app asking. An agent can list your bugs, read them, mark them fixed with a one-line note, and save one short question it asked you about a bug (so the panel can tell you it is waiting; the question is cleared once the bug is fixed). It can't see anyone else's bugs.

**How long it's kept:** a bug you've marked fixed is deleted 30 days after it was fixed. Waiting bugs stay until they're fixed or you delete them. "Delete all my cloud bugs" in the panel deletes them straight away. Deleting your account deletes every bug and disconnects every agent.

**What we don't do with it:** we don't read your bugs, sell them, use them for advertising, or train AI models on them. We look at stored data only if you ask us to help with a problem, or if the law requires it.

## The Mac app

The Darnly Mac app works the same way for bugs outside the browser: in Mac apps, the iOS Simulator and the Android Emulator. When you press its shortcut and click part of a window, it reads a screenshot of that window, the clicked element's details from macOS accessibility (its kind, title, label, value and accessibility id), the app's name and window title (and the page address, when the window is a browser), errors from the app's log (or the Simulator's or Emulator's log) in about the last 60 seconds, and the note you type. Secrets are hidden the same way. Reports are saved into the project folder you choose or, only if you choose "In the cloud" and sign in with Google, sent to your cloud inbox as described above. Your cloud sign-in is kept in the macOS Keychain.

It needs two macOS permissions: Accessibility (to know what you clicked) and Screen Recording (for the screenshot). To tell you when a new version is out, it reads Darnly's public release list on GitHub; that request carries nothing about you or your bugs.

## What Darnly never does

- It never sends data anywhere unless you turned on the cloud inbox, and then only to your own inbox.
- It never sells or shares data with third parties, and it has no analytics or tracking.
- It never uses data for anything except the bug reports you asked for.

## Permissions, and why

- **activeTab and scripting:** to show the element picker and take the screenshot on the tab where you pressed the shortcut.
- **sidePanel:** the Darnly panel where you type your note.
- **storage:** your settings and the linked folder.
- **offscreen:** keeps folder access alive so Chrome doesn't ask again every time the panel closes.
- **webRequest:** to notice failed requests (like a missing image) on localhost and sites you switch on.
- **Optional access to sites:** asked for one site at a time, only when you click "Record errors on this site". On those sites (and on localhost) Darnly also notes the shape of the data behind the element you capture.
- **identity** (version 0.2.0 and later): "Sign in with Google" for the cloud inbox. Used only when you click it.

## Contact

hello@darnly.dev
