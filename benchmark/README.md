# Does Darnly save agent tokens? A benchmark

The question: when an AI coding agent fixes a UI bug, does a Darnly report make it search less
(fewer grep and file reads), spend fewer tokens, and fix the bug more often than a plain description?

The test: a small shop app with 10 bugs we planted on purpose. Claude Code fixes each bug twice,
each time in a fresh session:

- **Plain:** the prompt is the sentence a user would type, for example
  "Clicking Save on the settings page does nothing."
- **Darnly:** the project has Darnly set up, the same sentence was typed into Darnly as the note,
  the report is in `.darnly/inbox/`, and the prompt is "fix my bugs".

The words are the same both ways, so the only difference is what Darnly adds: the screenshot,
the element, the source file, errors and failed requests. A browser test then checks whether the
bug is really fixed. Everything is recorded: tool calls, searches, file reads, tokens, cost, time.

## Run it (about 1 to 2 hours, mostly waiting)

You need Node 20 or newer and Claude Code, signed in. In a terminal:

```
cd benchmark
npm install
npx playwright install chromium
node run.mjs --reps 1
```

That first pass is 20 runs (10 bugs x 2 ways). It prints one line per run. When it ends:

```
node summarize.mjs
```

This prints the results and saves them as `summary.md` in the new `runs/<date-time>/` folder,
next to `results.csv` (one row per run; opens in Google Sheets or Excel).

For a number you can quote, run the full set, 3 repeats (60 runs), because the agent does not do
the same thing every time: `node run.mjs` then `node summarize.mjs`.

**Cost:** each run is a normal Claude Code session on a small app. On a Claude subscription it uses
your normal usage limits; on an API key, expect very roughly $0.05 to $0.50 per run depending on the model.
Pick a model with `--model sonnet` (or `opus`, `haiku`). Use the same model for every run you compare.

Other options: `--bugs b01-place-order,b07-orders-empty` to run only some bugs, `--keep` to keep
each run's project folder in `runs/<date-time>/work/` so you can look at what the agent changed,
and `--conditions plain,report-only,darnly` to add a third way: the same report with the prompt
"Fix the bug described in .darnly/inbox/<file>.md", but without Darnly's setup files. The gap between
"report-only" and "darnly" is what Darnly's workflow (the skill, noting the fix, moving files) costs.

## What is in this folder

| Path | What it is |
|---|---|
| `app/` | The sample app, "Pebble Store" (React + Vite, about 30 files, mock API). It has the 10 bugs. |
| `bugs.mjs` | The 10 bugs: the user's sentence, how to reproduce it, and the browser test that proves it fixed. |
| `reports/` | The real Darnly reports for each bug, captured with the actual extension, plus the files "Set up this project" adds. |
| `run.mjs` | Runs Claude Code on each bug both ways and records the numbers. |
| `check.mjs` | Checks which bugs are fixed in a folder: `node check.mjs app` shows all 10 broken. |
| `summarize.mjs` | Turns `results.csv` into `summary.md`. |
| `capture-reports.mjs` | Re-captures the Darnly reports. Only needed when the app, the bugs or Darnly's report format change. |
| `reference-fixes.patch` | One correct fix for each bug, to prove the browser tests pass when the bugs are fixed. The agent never sees it. |

## The 10 bugs

| Bug | What the user sees | Kind |
|---|---|---|
| b01 | Place order button looks faded and ignores clicks | CSS |
| b02 | Cart subtotal doesn't go up with quantity | logic |
| b03 | Product pictures are broken | network |
| b04 | Save on settings does nothing | runtime error |
| b05 | Long product names spill out of the card | CSS |
| b06 | Dark mode switch does nothing | state |
| b07 | Orders page says no orders | network |
| b08 | Subscribe button is grey, should be blue | CSS |
| b09 | The X on the size guide popup doesn't close it | state |
| b10 | Search for "lamp" finds nothing | logic |

The mix is deliberate. Darnly should help most with CSS, errors and failed requests, and least with
logic bugs, where the report shows the symptom but the cause is in another file.

## How a run works

1. Copy `app/` into a fresh folder and make it a git repository (so changes can be seen).
2. Darnly runs only: add the files "Set up this project" adds (AGENTS.md and the skill), then put
   that bug's report in `.darnly/inbox/`.
3. Start Claude Code in that folder with `claude -p`, no MCP servers and no personal settings, so
   both ways get the same agent. The agent may read, search and edit files, and run `tsc` or
   `npm run build`. It may not start the app or browse.
4. Read the numbers from Claude Code's own log of the session.
5. Start the app and run that bug's browser test.

## What the numbers mean

- **Cost:** Claude Code's own estimate for the session. This is the fairest single number, because
  it weighs each kind of token by its price.
- **Tokens:** everything sent and received, including the context resent every turn
  (most of it cheap cache reads). A screenshot adds tokens up front; the hope is it saves more later.
- **Searches:** Grep, Glob, and shell `grep`, `rg`, `find`, `ls`.
- **File reads:** Read, plus shell `cat`, `head`, `tail`. Reading the Darnly report counts too.
- **Fixed:** the browser test passed afterwards.
- **Asked instead of fixing:** the run changed nothing and ended with a question.

`summarize.mjs` compares the median per bug, counts on how many of the 10 bugs Darnly was cheaper,
and says whether that could be luck (a sign test). Only call it a win if it says "unlikely to be luck".

## Limits (say these out loud if you publish a number)

- **One small app, bugs we planted.** We wrote the bugs knowing what Darnly captures, which may
  favour it. A real project is bigger, which usually makes searching cost more, but that is a guess.
  The strongest claim comes from your own real bugs (see below).
- **Localhost, React dev build.** That is where Darnly can name the source file. On a live, built
  site it can't, and the saving is likely smaller.
- **No follow-up questions.** `claude -p` can't ask the user anything, so this measures one-shot
  fixes. In real use, a vague plain description often costs an extra round trip, which this misses.
  That likely understates Darnly's advantage.
- **The baseline is a sentence with no screenshot.** Some users paste a screenshot or name the
  file. That is a stronger baseline we have not tested yet.
- **Agents vary.** The same prompt can take 5 tool calls one time and 15 the next. That is why
  there are repeats, and why a 20-run first pass is a first look, not a result.
- **One agent, one model.** Codex and Cursor may behave differently.

## Wording a claim honestly

Good: "In our benchmark of 10 UI bugs on a React app, Claude Code fixed bugs with Darnly reports
at X% lower cost and Y% fewer searches (median, 3 runs per bug)." Link the method.
Avoid: "Darnly cuts your token bill by X%." We measured one app, not your bill.

## First pilot (2026-11-01, Sonnet, 1 run each, 3 bugs: not a result)

Eleven runs (five plain vs Darnly pairs, plus one "report only") to check the harness. Every run fixed its bug. On this small app, Darnly runs cost
more, not less: about $0.06 to $0.08 plain vs $0.12 with Darnly for the checkout and settings bugs
(one orders run went the other way, $0.18 vs $0.09, partly because the cache was cold; the
warm-up session now prevents that).

Why, from the transcripts: in a 30-file app one grep for the button text finds the right file, so
there is little search to save. Darnly runs did read fewer files (5 vs 2, 3 vs 1), but spent
about 9 extra tool calls on Darnly's own steps: loading the skill, reading the report and screenshot,
writing the **Fixed:** line and moving three files to `done/` (a wildcard `mv` is refused and retried).
Even "report only" spent 3 calls moving files, because the report itself asks for it.

Also seen: the `code:` line numbers are wrong on Vite + React 19 (for example `CheckoutPage.tsx:117`
in a 64-line file, because they come from the transformed code), and broken images on a Vite app
are not reported as failed requests (Vite answers missing files with the page, status 200).

## Also try it on real bugs (by hand)

The best evidence is your own bugs in your own project, during your two weeks of daily use. When
you hit a bug and it's easy to undo the fix (`git stash`), fix it twice in fresh Claude Code
sessions: once from a plain sentence, once from Darnly. After each, type `/cost` and note it in
`results-sheet.csv` (copy it into Google Sheets). Five bugs done this way is worth quoting next to
the benchmark, because it's real.
