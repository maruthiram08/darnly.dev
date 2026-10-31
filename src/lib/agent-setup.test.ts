import { describe, expect, it } from 'vitest';
import { agentsBlock, mergeAgentsMd, mergeClaudeMd, mergeGitignore, planSetup, skillMd } from './agent-setup';

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
