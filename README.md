# Darnly (Darnly)

A Chrome extension that turns a bug you see on screen into a ready-to-fix note for your AI coding agent.
Captures land as plain files in `.<name>/inbox/` inside your project, so Claude Code, Codex and Cursor can all read them.

## Renaming the product

The name lives in one file: `src/config/product.ts`. Change `NAME` and `SLUG` there.
The extension name, the `.<slug>/` folder, the AGENTS.md markers and the skill paths all follow.
(`spike/folder-test/` is a throwaway test and has its own copy.)

## Commands

- `npm install` once
- `npm run dev` opens Chrome with the extension, reloading on save
- `npm run build` builds into `.output/chrome-mv3/` (load it at chrome://extensions with "Load unpacked")
- `npm test` runs the unit tests

## Folders

- `src/config/product.ts`: product name
- `src/entrypoints/`: background (hotkey), side panel (note box); picker and recorder come next
- `src/lib/`: pure helpers with unit tests
- `spike/folder-test/`: day-one folder-write test (no build step; load the folder unpacked)
