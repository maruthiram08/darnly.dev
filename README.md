# Darnly

A Chrome extension that turns a bug you see on screen into a ready-to-fix note for your AI coding agent.
Captures land as plain files in `.darnly/inbox/` inside your project, so Claude Code, Codex and Cursor can all read them.

## Install (before the Chrome Web Store listing is live)

1. Download the latest zip and unzip it.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.
3. Pin Darnly, open it, and answer the first question: is your code on this computer (link the project folder) or in the cloud?
4. Check the shortcut at `chrome://extensions/shortcuts` (default Option+Shift+B on Mac, Alt+Shift+B elsewhere).

## Use

1. On any page, press the shortcut and click the broken part (↑ ↓ for a bigger or smaller box, Esc for the whole page).
2. Type what you expected and press Enter.
3. Project on this computer: click **Set up this project** once, then tell your agent "fix my bugs".
   Cloud project: click **1. Copy picture**, paste into your agent, then **2. Copy details** and paste.

Console errors are recorded on localhost automatically. For a live site, click **Record errors on this site** once.
See [PRIVACY.md](PRIVACY.md) for what is captured and hidden.

## Renaming the product

The name lives in one file: `src/config/product.ts`. Change `NAME` and `SLUG` there.
The extension name, the `.<slug>/` folder, the AGENTS.md markers and the skill paths all follow.
(`spike/folder-test/` is a throwaway test and has its own copy.)

## Commands

- `npm install` once
- `npm run dev` opens Chrome with the extension, reloading on save
- `npm run build` builds into `.output/chrome-mv3/` (load it at chrome://extensions with "Load unpacked")
- `npm test` runs the unit tests
- `npm run zip` makes the store zip in `.output/`
- Store listing text: `store/listing.md`

## Folders

- `src/config/product.ts`: product name
- `src/entrypoints/`: background (hotkey, screenshot), picker (content script), side panel (note box, saving), keepalive (holds folder access)
- `tests/e2e/`: `npm run e2e` captures a planted bug on a sample page and checks the files
- `src/lib/`: pure helpers with unit tests
- `spike/folder-test/`: day-one folder-write test (no build step; load the folder unpacked)
