# Darnly privacy policy

Last updated: 1 November 2026

Darnly is a Chrome extension that turns a bug you see on a web page into a report your AI coding agent can read. This policy explains what it touches and where that goes.

## The short version

Darnly has no server and no account. Nothing it captures is sent to us or to anyone else. Every report stays on your computer until you choose to paste or share it.

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

Darnly keeps the link to your project folder, and your settings, in Chrome's own storage on your computer.

## What Darnly never does

- It never sends data to Darnly or to any third party.
- It never sells or shares data, and it has no analytics or tracking.
- It never uses data for anything except making the bug report you asked for.

## Permissions, and why

- **activeTab and scripting:** to show the element picker and take the screenshot on the tab where you pressed the shortcut.
- **sidePanel:** the Darnly panel where you type your note.
- **storage:** your settings and the linked folder.
- **offscreen:** keeps folder access alive so Chrome doesn't ask again every time the panel closes.
- **webRequest:** to notice failed requests (like a missing image) on localhost and sites you switch on.
- **Optional access to sites:** asked for one site at a time, only when you click "Record errors on this site".

## Contact

hello@darnly.dev
