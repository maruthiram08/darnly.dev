# Darnly privacy policy

Last updated: 1 November 2026

Darnly is a Chrome extension that turns a bug you see on a web page into a report your AI coding agent can read. This policy explains what it touches and where that goes.

## The short version

By default Darnly has no account and sends nothing to us. Every report stays on your computer until you choose to paste or share it.

From version 0.2.0 there is one exception, and only if you turn it on: the **cloud inbox**, for projects whose code isn't on your computer. If you sign in to it, each bug you capture is sent to your private Darnly inbox so your coding agent can read it. The section "The cloud inbox" below explains exactly what that means.

## What Darnly reads, and only when you capture

When you press the Darnly shortcut and click part of a page, Darnly reads:

- a screenshot of the visible page;
- details about the element you clicked: its text, HTML, styles, size and position, and its React component name and source file when the page exposes them;
- the page address and title;
- console errors and failed network requests from about the last 60 seconds, on localhost and on sites you switch recording on for. On other sites, only failed requests the browser already lists for the page;
- the note you type.

Darnly does not read pages you do not capture. On localhost, and on sites you switch on, a small recorder keeps the last 60 seconds of errors in the page's memory, so they are ready if you capture. That buffer never leaves the page unless you capture.

## What Darnly hides

Before anything is saved, Darnly removes things that look like secrets: passwords and card numbers (also blurred in the screenshot), auth headers, cookies, request and response bodies beyond a short error snippet, tokens, API keys and secret-looking query parameters. These are replaced with `[hidden]`.

## Where reports go

- **Into your project folder**, if you link one. Reports are written to a `.darnly/` folder inside it, which Darnly also adds to `.gitignore` so it isn't committed.
- **Onto your clipboard**, if you click a copy button. You decide where to paste it.

- **Into your Darnly cloud inbox**, only if you chose "My code is in the cloud" and signed in (version 0.2.0 and later).

Darnly keeps the link to your project folder, your settings and (if you use the cloud inbox) your sign-in, in Chrome's own storage on your computer.

## The cloud inbox (optional, version 0.2.0 and later)

**What is sent:** for each bug you capture while signed in, the report (the same text you would otherwise save or paste), the marked screenshot, and the recent errors, all after the secrets above have been removed on your computer. Also your Google account's email address and Google's account id, to know whose inbox it is.

**Where it lives:** on Cloudflare, which runs Darnly cloud for us (a database for the bug list, file storage for screenshots and reports). Data is encrypted at rest by Cloudflare.

**Who can see it:** only you, and the coding agents you connect yourself. To connect an agent, you add Darnly as a connector in that agent and approve it on a Darnly page that names the app asking. An agent can list your bugs, read them and mark them fixed. It can't see anyone else's bugs.

**How long it's kept:** a bug you've marked fixed is deleted 30 days after it was fixed. Waiting bugs stay until they're fixed or you delete them. "Delete all my cloud bugs" in the panel deletes them straight away. Deleting your account deletes every bug and disconnects every agent.

**What we don't do with it:** we don't read your bugs, sell them, use them for advertising, or train AI models on them. We look at stored data only if you ask us to help with a problem, or if the law requires it.

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
- **Optional access to sites:** asked for one site at a time, only when you click "Record errors on this site".
- **identity** (version 0.2.0 and later): "Sign in with Google" for the cloud inbox. Used only when you click it.

## Contact

hello@darnly.dev
