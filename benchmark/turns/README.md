# Turns to fix: screenshot vs Darnly

The question: when you hit a UI bug while using your app, does a Darnly capture get it fixed in
**fewer messages** than pasting a screenshot and typing a sentence into Claude Code? In particular, does it
stop the agent asking "is this just here, or everywhere?" and stop it fixing the wrong scope?

The first benchmark (`../README.md`) used a 30-file demo app and a one-shot prompt with no screenshot. This
one is closer to real use:

- **A real, larger app:** [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT), pinned to one commit.
  About 1,300 files, 770 of them `.ts`/`.tsx`/`.scss`, in a yarn monorepo with React and Vite.
- **A stronger baseline:** the screenshot is pasted into the conversation (as an image), with the same
  sentence the Darnly user typed as the note.
- **Conversations, not one shot:** after every agent turn, the harness reloads the app in a browser and
  checks the bug. If it isn't fixed, or fixed in the wrong scope, a simulated user replies: a small model
  playing a non-technical person who can only see the app. It answers the agent's questions with what it
  could see, and says what is still wrong. Up to 4 user messages per bug.
- **Scope checks:** 4 bugs need a fix in a shared place (a theme token or shared component) because the same
  problem shows up elsewhere; 4 need a local fix, where changing the shared place would break other things.
  The user only reports where they noticed it. The browser checks test both the reported spot and the other
  places.

## Result (2026-11-01, Sonnet, 8 bugs × 2 ways × 2 repeats = 32 conversations)

**Both ways fixed every bug from the first message, with the right scope. No agent asked a follow-up
question. Darnly cost about 1.6 times as much** ($0.11 vs $0.07 per bug on average), because of its own
workflow steps, not because of the code search.

| | Screenshot + sentence | Darnly |
|---|---|---|
| Fixed, right scope (checked in a browser) | 16 of 16 | 16 of 16 |
| Fixed from the first message | 16 of 16 | 16 of 16 |
| Follow-up questions from the agent | 0 | 0 |
| Fixed the wrong scope at some point | 0 | 0 |
| Cost per bug (average) | $0.07 | $0.11 |
| Tokens per bug (median) | 157,000 | 358,000 |
| Searches per bug (average) | 3.2 | 2.1 |
| File reads per bug (average) | 2.7 | 1.6 |
| Tool calls per bug (average) | 6.3 | 14.9 |
| …of which Darnly's own steps | 0 | 10.6 |

Full numbers: `results/2026-11-01/summary.md` and `results.csv`.

What it means, plainly:

1. **The report itself helps a little.** With Darnly, the agent searched and read about a third less code to
   find the bug (2.1 vs 3.2 searches, 1.6 vs 2.7 reads).
2. **The workflow eats that and more.** About 10 of Darnly's 15 tool calls were bookkeeping: loading the
   skill, listing and reading the inbox, opening the PNG and logs, writing the **Fixed:** line, and moving
   three files to `done/` (often several tries, because a combined `mkdir && mv` or a wildcard `mv` gets
   refused). In real use each refused command is a permission prompt the person has to click.
3. **"Local or global?" didn't come up.** With a screenshot, Sonnet found the shared theme token for the
   colour and corner bugs, and kept local bugs local, every time. Excalidraw is well organised (one theme
   file, clear class names), and these bugs are visible in a screenshot, so the screenshot was enough.
4. **So, on this evidence, don't sell Darnly on tokens or fewer turns yet.** Sell the capture convenience
   (one hotkey instead of screenshot + switching windows + typing context) and the cases a screenshot can't
   show: console errors, failed requests, state after several steps, bugs on a page you're not in the
   terminal for.

## Things Darnly should change (found in this run)

- **Make the `done/` bookkeeping one step or none.** It is most of the extra cost. For example: write the
  **Fixed:** line only and let the extension move the files when it sees it, or put the three files in one
  folder per bug so a single `mv` works.
- **The picked element is often too deep.** Clicking the share button gave `… > svg > path`; clicking the
  zoom + gave `… > div.ToolIcon__icon > svg > path`. Walk up to the nearest button, link or element with a
  class before reporting.
- **Non-clickable elements can't be picked.** The hint text under the toolbar has `pointer-events: none`,
  so the click went to the canvas underneath and the report described the canvas. The agent fixed it anyway
  from the note, but the element data was wrong.
- **No `code:` line on React 19.** React 19 removed the source location Darnly used, so none of the 8
  reports named a file. The component chain (`ZoomActions > … > IconButton`) still helped.
- **Noise in "Failed requests".** Every report listed 5 font requests that failed with
  `net::ERR_CACHE_MISS`. They are probably an artifact of headless Chrome in this harness, but they read as
  a lead. Leave out `ERR_CACHE_MISS` (and maybe fonts) unless the user's note mentions text or fonts.

## Limits (say these if you quote the result)

- **8 bugs we planted, one app, one model (Sonnet), 2 repeats.** Planted bugs are cleaner than real ones:
  one changed line, visible on screen. Real bugs that need several steps to reproduce, or that show up only
  in the console, are where Darnly should do better, and this set has only one (the reset-canvas error).
- **The simulated user was never needed.** Every run was fixed at message 1, so this run says nothing yet
  about how well the simulated user stands in for a person.
- **One run was rescored.** In the first pass, one Darnly run set the Help title to 18px instead of 20px and
  the check wrongly demanded exactly 20px; the agent then spent 3 more turns confused because the report's
  file paths and port pointed at the capture folder, not its own. Both were harness bugs. The check now
  accepts any normal heading size, the harness rewrites the report's paths and port to the run's own (as in
  real use), and that run was replaced by a rerun (fixed at message 1, $0.08).
- **The agent may not run the app** (the user does that). An agent that can open a browser itself (Claude in
  Chrome, Chrome DevTools MCP) is a different comparison.

## Run it

You need Node 20+, Claude Code signed in, and about 1.5 GB of disk.

```
cd benchmark && npm install && cd turns
node setup.mjs          # downloads Excalidraw at the pinned commit and installs it (1 to 3 minutes)
node verify.mjs         # proves each bug is real and each check passes on a clean copy
node run.mjs --model sonnet --reps 2      # 32 conversations, about 30 to 45 minutes, about $3
node summarize.mjs
```

Options: `--bugs x01-primary-colour,x05-zoom-in`, `--conditions screenshot,darnly,text` (`text` = the
sentence with no screenshot), `--max-messages 4`, `--user-model haiku`, `--keep` (keep each run's folder in
`runs/<date>/work/` to see the diff). Each run's conversation and diff are saved as
`runs/<date>/transcripts/<bug>-<way>-r<n>.dialogue.md`.

To re-capture the screenshots and Darnly reports (only when the bugs or Darnly's report format change):
`DARNLY_E2E=1 npx wxt build` from the repo root, then `node capture.mjs`.

## Files

| Path | What it is |
|---|---|
| `app/excalidraw.mjs` | Pins Excalidraw, makes a fresh copy per run, starts it, runs the checks. |
| `app/bugs.mjs` | The 8 bugs: the user's sentence, the planted change, the browser checks, what the user knows. |
| `captures/` | The pasted screenshot and the real Darnly report for each bug, plus Darnly's setup files. |
| `run.mjs` | Runs the conversations and records everything to `runs/<date>/results.csv`. |
| `lib/session.mjs` | A multi-turn Claude Code session over `claude -p --input-format stream-json`. |
| `lib/user.mjs` | The simulated user. |
| `lib/measure.mjs` | Counts tool calls, searches, reads, edits, Darnly steps, tokens and cost. |
| `verify.mjs`, `capture.mjs`, `setup.mjs`, `summarize.mjs` | See "Run it". |
| `results/2026-11-01/` | This run's summary and per-run numbers. |

## The 8 bugs

| Bug | What the user says | Kind | Right fix |
|---|---|---|---|
| x01 | The share button turned green, should be purple | CSS | global: the theme's primary colour |
| x02 | The Help window's title is tiny | CSS | global: the shared dialog title style |
| x03 | The 100% zoom number is faint | CSS | local: that button's colour |
| x04 | Reset the canvas does nothing after Confirm | runtime error | local: the action's code |
| x05 | Zoom + makes things smaller | logic | local: the zoom-in action |
| x06 | The toolbar lost its rounded corners | CSS | global: the theme's corner radius |
| x07 | Main menu items don't highlight on hover | CSS | global: the shared menu item style |
| x08 | The hint under the toolbar is huge | CSS | local: the hint's font size |
