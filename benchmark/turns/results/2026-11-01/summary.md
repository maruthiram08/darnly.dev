# Turns to fix: screenshot vs Darnly

App: Excalidraw (8bcdca4), 8 planted UI bugs. Agent: Claude Code, model sonnet. Simulated user: haiku. Up to 4 user messages per bug. Runs: 32.

## Overall

| | Screenshot + sentence | Darnly |
|---|---|---|
| Fixed, right scope (checked in a browser) | 16 of 16 | 16 of 16 |
| Fixed from the first message | 16 of 16 | 16 of 16 |
| User messages per bug (average) | 1.0 | 1.0 |
| Follow-up questions from the agent (total) | 0 | 0 |
| Runs that fixed the wrong scope at some point | 0 | 0 |
| Cost per bug (average) | $0.07 | $0.11 |
| Tokens per bug (median) | 157,109 | 357,700 |
| Searches per bug (average) | 3.2 | 2.1 |
| File reads per bug (average) | 2.7 | 1.6 |
| Tool calls per bug (average) | 6.3 | 14.9 |
| …of which Darnly steps | 0.0 | 10.6 |
| Agent time per bug, seconds (average) | 11 | 23 |

## Global bugs (the fix belongs in a shared place)

| | Screenshot + sentence | Darnly |
|---|---|---|
| Fixed, right scope | 8 of 8 | 8 of 8 |
| Fixed from the first message | 8 of 8 | 8 of 8 |
| User messages (average) | 1.0 | 1.0 |
| Wrong scope at some point | 0 | 0 |
| Cost (average) | $0.07 | $0.11 |
| Searches (average) | 2.9 | 2.9 |

## Local bugs (the fix belongs in one component)

| | Screenshot + sentence | Darnly |
|---|---|---|
| Fixed, right scope | 8 of 8 | 8 of 8 |
| Fixed from the first message | 8 of 8 | 8 of 8 |
| User messages (average) | 1.0 | 1.0 |
| Wrong scope at some point | 0 | 0 |
| Cost (average) | $0.08 | $0.12 |
| Searches (average) | 3.5 | 1.4 |

## Per bug

| Bug | Kind | Scope | Screenshot + sentence: messages · questions · cost | Darnly: messages · questions · cost |
|---|---|---|---|---|
| x01-primary-colour | css | global | 1 · 0 · $0.06; 1 · 0 · $0.06 | 1 · 0 · $0.13; 1 · 0 · $0.12 |
| x02-dialog-title | css | global | 1 · 0 · $0.07; 1 · 0 · $0.06 | 1 · 0 · $0.10; 1 · 0 · $0.08 |
| x03-zoom-label-faint | css | local | 1 · 0 · $0.07; 1 · 0 · $0.07 | 1 · 0 · $0.14; 1 · 0 · $0.14 |
| x04-reset-canvas | runtime-error | local | 1 · 0 · $0.09; 1 · 0 · $0.10 | 1 · 0 · $0.11; 1 · 0 · $0.10 |
| x05-zoom-in | logic | local | 1 · 0 · $0.07; 1 · 0 · $0.06 | 1 · 0 · $0.12; 1 · 0 · $0.11 |
| x06-square-corners | css | global | 1 · 0 · $0.06; 1 · 0 · $0.07 | 1 · 0 · $0.10; 1 · 0 · $0.13 |
| x07-menu-hover | css | global | 1 · 0 · $0.08; 1 · 0 · $0.08 | 1 · 0 · $0.12; 1 · 0 · $0.11 |
| x08-hint-size | css | local | 1 · 0 · $0.07; 1 · 0 · $0.09 | 1 · 0 · $0.10; 1 · 0 · $0.11 |

✗ = not fixed with the right scope within the message limit.

