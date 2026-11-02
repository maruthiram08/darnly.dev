import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentsBlock, HOOK_MARK, hookCommands, mergeAgentsMd, mergeClaudeMd, mergeClaudeSettings, mergeCursorCommand, mergeGitignore, planSetup, skillMd } from './agent-setup';

describe('mergeAgentsMd', () => {
  it('creates AGENTS.md when missing', () => {
    expect(mergeAgentsMd(null)).toContain('.darnly/inbox/');
  });

  it('appends without touching existing text', () => {
    const out = mergeAgentsMd('# Rules\n\nUse pnpm.\n')!;
    expect(out.startsWith('# Rules\n\nUse pnpm.')).toBe(true);
    expect(out).toContain(agentsBlock());
  });

  it('replaces an old block in place and is idempotent', () => {
    const old = 'Top\n\n<!-- darnly:start -->\nold text\n<!-- darnly:end -->\n\nBottom\n';
    const out = mergeAgentsMd(old)!;
    expect(out).not.toContain('old text');
    expect(out).toMatch(/^Top[\s\S]*Bottom\n$/);
    expect(mergeAgentsMd(out)).toBeNull();
  });
});

describe('mergeClaudeMd', () => {
  it('adds @AGENTS.md once, and never creates CLAUDE.md', () => {
    expect(mergeClaudeMd(null)).toBeNull();
    const out = mergeClaudeMd('# Project\n')!;
    expect(out).toContain('@AGENTS.md');
    expect(mergeClaudeMd(out)).toBeNull();
  });
});

describe('mergeGitignore', () => {
  it('adds .darnly/ once', () => {
    const out = mergeGitignore('node_modules\n')!;
    expect(out).toContain('\n.darnly/\n');
    expect(mergeGitignore(out)).toBeNull();
    expect(mergeGitignore(null)).toBeNull();
  });
});

describe('planSetup', () => {
  it('plans every file on a fresh project, and nothing on a set-up one', () => {
    const fresh = planSetup({ 'CLAUDE.md': '# x\n', '.gitignore': 'dist\n' });
    expect(fresh.map((c) => `${c.action} ${c.path}`)).toEqual([
      'create AGENTS.md',
      'update CLAUDE.md',
      'update .gitignore',
      'create .claude/settings.json',
      'create .cursor/commands/darnly.md',
      'create .agents/skills/darnly/SKILL.md',
      'create .claude/skills/darnly/SKILL.md',
    ]);
    const after = Object.fromEntries(fresh.map((c) => [c.path, c.content]));
    expect(planSetup(after)).toEqual([]);
  });

  it('skill has a name and description agents can trigger on', () => {
    expect(skillMd()).toMatch(/^---\nname: darnly\ndescription: .*fix my bugs/m);
  });
});

describe('Claude Code hooks', () => {
  it('adds both hooks, keeps other settings, and is idempotent', () => {
    const existing = JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } });
    const out = mergeClaudeSettings(existing)!;
    const s = JSON.parse(out);
    expect(s.permissions.allow).toEqual(['Bash(npm test)']);
    expect(s.hooks.UserPromptSubmit).toHaveLength(2);
    expect(s.hooks.UserPromptSubmit[0].hooks[0].command).toBe('echo mine');
    expect(s.hooks.SessionStart[0].hooks[0].command).toContain(HOOK_MARK);
    expect(mergeClaudeSettings(out)).toBeNull();
  });

  it('never overwrites a settings file it cannot read', () => {
    expect(mergeClaudeSettings('{ not json')).toBeNull();
    expect(mergeClaudeSettings(null)).toContain('SessionStart');
  });

  it('never overwrites a /darnly Cursor command the user wrote', () => {
    expect(mergeCursorCommand('my own command')).toBeNull();
    expect(mergeCursorCommand(null)).toContain('.darnly/inbox/');
    expect(mergeCursorCommand(mergeCursorCommand(null))).toBeNull();
  });

  it('is part of the setup plan', () => {
    expect(planSetup({}).map((c) => c.path)).toContain('.claude/settings.json');
  });

  it('tells the agent about waiting bugs, then only about new ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'darnly-hook-'));
    const run = (cmd: string) => execFileSync('sh', ['-c', cmd], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).toString();
    const { sessionStart, promptSubmit } = hookCommands();
    expect(run(sessionStart)).toBe(''); // no .darnly folder: silent
    mkdirSync(join(dir, '.darnly/inbox'), { recursive: true });
    writeFileSync(join(dir, '.darnly/inbox/a.md'), 'x');
    expect(run(sessionStart)).toMatch(/^Darnly: 1 captured bug\(s\) waiting in \.darnly\/inbox\//);
    expect(run(promptSubmit)).toBe(''); // already told
    const later = new Date(Date.now() + 5000);
    writeFileSync(join(dir, '.darnly/inbox/b.md'), 'x');
    utimesSync(join(dir, '.darnly/inbox/b.md'), later, later);
    expect(run(promptSubmit)).toMatch(/^Darnly: 1 new captured bug\(s\)/);
  });
});
