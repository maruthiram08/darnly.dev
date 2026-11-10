# Does a Darnly report help the agent fix the right thing?

The first two benchmarks (`../README.md`, `../turns/README.md`) asked whether Darnly saves tokens or
messages. On those apps the agent fixed every bug with or without Darnly, so they could not show whether
the report helps it **fix the right thing**. This eval asks that directly, at a larger scale, with harder
inputs:

- **30 bugs** in the Pebble Store app (`../app`): the 10 from the first benchmark plus 20 new ones. Each run's
  app has **only that bug** (the eval builds a clean copy and plants one bug), so every page works except the
  broken one.
- **Three ways to report the bug**, same words each time:
  - **Text only:** the user's note, typed into the chat.
  - **Screenshot + text:** the same note plus a plain screenshot of the window (what people paste today).
  - **Darnly report:** the real Darnly report made with the actual extension for the same note (the .md and the
    PNG with the red box; the logs file is in `.darnly/inbox/` for the agent to open).
- **Two kinds of notes:** a **clear** sentence ("On the cart page the minus button makes the quantity go up
  instead of down.") and the **short** thing a hurried user types ("minus button wrong"). Darnly's claim is
  that pointing at the bug carries the context, so the short note matters most.
- **A real browser check** decides "fixed". Some checks also make sure the fix didn't change other things
  (for example, made every ghost button blue to fix one button): that counts as **wrong scope**.
- **The agent** is Claude through the API with five tools (list files, search, read, edit, finish). The same
  agent and prompt are used for every way. It can't run the app or open a browser.

The mix of bugs is deliberate: 11 CSS/look, 6 state, 4 network, 1 runtime error, 8 logic. Darnly should help
most with look, errors and failed requests, and least with logic bugs, where the screen shows the symptom but
the cause is elsewhere.

What it doesn't measure: Darnly's own bookkeeping (moving files to `done/`, which the token benchmark
measured), the time it takes a person to capture a bug, or bugs in big codebases (Pebble is about 40 files,
so an agent can read much of it; that makes text-only look better than in a real project).

## Run it

From `benchmark/eval`, with Node 20+ and the Chromium that Playwright uses:

```
npm install
node validate.mjs          # every check fails on the planted bug and passes on the clean app (no API)
node run.mjs --mock        # the whole pipeline with a fake agent that applies the known fix (no API)
DARNLY_TEST_ANTHROPIC_KEY=... node run.mjs --models sonnet,haiku --budget 35 --workspace <workspace id>
node summarize.mjs runs/<date-time>
```

`run.mjs` stops before spending more than `--budget` dollars (prices are in the script). It runs the three ways
of each bug together, so a stopped run still compares complete sets; continue with `--resume runs/<dir>`.
Results: `runs/<dir>/summary.md`, `results.csv` (one row per run) and a transcript plus diff for every run.

`capture.mjs` re-makes the reports in `captures/` with the real extension. Only needed when the app, the bugs
or Darnly's report format change: build the extension first with `DARNLY_E2E=1 npx wxt build` (repo root).

## The 30 bugs

See `bugs.mjs` for the notes, how each is planted and the browser check.

| Bug | What the user sees | Kind |
|---|---|---|
| b01 | Place order button faded, ignores clicks | css |
| b02 | Cart subtotal doesn't go up with quantity | logic |
| b03 | Product pictures broken | network |
| b04 | Save on settings (profile) does nothing | runtime error |
| b05 | Long product names spill out of the card | css |
| b06 | Dark mode switch does nothing | state |
| b07 | Orders page says no orders | network |
| b08 | Subscribe button grey, should be blue | css |
| b09 | X on the size guide popup doesn't close it | state |
| b10 | Search for "lamp" finds nothing | logic |
| b11 | Help answers tiny | css |
| b12 | Contact tab shows nothing | state |
| b13 | Save on settings (notifications) does nothing | network |
| b14 | Order dates say Invalid Date | logic |
| b15 | Remove takes out the wrong items | logic |
| b16 | Minus button makes the quantity go up | state |
| b17 | "Browse the shop" button washed out (fix only this one) | css |
| b18 | Top menu doesn't show the current page | css |
| b19 | Some ratings show 4 stars in total | logic |
| b20 | Top bar stays light in dark mode | css |
| b21 | Newsletter subscribe does nothing | network |
| b22 | Cart count counts items, not quantity | logic |
| b23 | Clicking a size doesn't select it | state |
| b24 | Checkout inputs cut off | css |
| b25 | "shipped" label grey, should be blue (only that one) | css |
| b26 | Footer links squashed together | css |
| b27 | $50 cart still charged shipping | logic |
| b28 | Escape doesn't close the popup | state |
| b29 | "Back to cart" goes to Page not found | logic |
| b30 | Search box white in dark mode | css |

Note that b04 and b13 have the same short note ("save not working") on the same page: only the report,
the screenshot or luck tells the agent which Save button.
