// A Claude Code session the harness can talk to over several turns, like a person in the terminal.
// Uses `claude -p --input-format stream-json`: one process, one conversation; each user message is a
// line on stdin, and each agent turn ends with a `result` event (which carries that turn's usage and cost).
import fs from 'node:fs';
import { spawn } from 'node:child_process';

// Variables that tie a child to the parent Claude Code session (when the harness itself runs inside one).
const PARENT_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_REMOTE_SESSION_ID|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SESSION_ATTENDED)$/;
export const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !PARENT_VARS.test(k)));

export function startSession({ cwd, model, allowedTools, transcriptPath, claudeBin = 'claude', timeoutMin = 20 }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'];
  if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
  if (model) args.push('--model', model);
  const child = spawn(claudeBin, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  const out = fs.createWriteStream(transcriptPath);
  const events = [];
  let stderr = '';
  let buf = '';
  let waiting = null; // resolver for the turn in progress
  let turnStart = 0;
  let closed = false;

  child.stdout.on('data', (d) => {
    out.write(d);
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      events.push(e);
      if (e.type === 'result' && waiting) {
        const w = waiting;
        waiting = null;
        w({ result: e, events: events.slice(turnStart) });
      }
    }
  });
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (code) => {
    closed = true;
    out.end();
    if (waiting) waiting({ result: null, events: events.slice(turnStart), error: `claude exited ${code}: ${stderr.trim().split('\n').pop() ?? ''}` });
    waiting = null;
  });

  // Send one user message (a string, or content blocks such as an image + text) and wait for the agent's turn to end.
  function send(content) {
    if (closed) return Promise.resolve({ result: null, events: [], error: 'session closed' });
    turnStart = events.length;
    const p = new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMin * 60_000);
      waiting = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
    });
    child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    return p;
  }

  function close() {
    if (!closed) child.stdin.end();
    return new Promise((r) => (closed ? r() : child.on('close', r)));
  }

  return { send, close, events };
}

// Ask a model one question with no tools (used for the simulated user). Returns the text.
export function ask({ prompt, system, model = 'haiku', claudeBin = 'claude', cwd }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--model', model, '--tools', '', '--strict-mcp-config',
      '--setting-sources', 'project', '--no-session-persistence'];
    if (system) args.push('--system-prompt', system);
    const child = spawn(claudeBin, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      try {
        const r = JSON.parse(out);
        resolve({ text: (r.result ?? '').trim(), cost: r.total_cost_usd ?? 0 });
      } catch {
        reject(new Error('simulated user failed: ' + (err || out).slice(0, 300)));
      }
    });
  });
}
