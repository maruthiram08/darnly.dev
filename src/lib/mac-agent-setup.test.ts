import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentsBlock, CURSOR_COMMAND_PATH, cursorCommand, HOOK_MARK, hookCommands, skillMd } from '@/lib/agent-setup';
import { AGENTS_MARKER_END, AGENTS_MARKER_START, SKILL_PATHS } from '@/config/product';

/**
 * The Mac app writes the same agent setup (AGENTS.md block, skill, Cursor command, Claude Code hooks) as the
 * extension. Its texts are generated from agent-setup.ts into a Swift file, so the two never drift.
 * After changing agent-setup.ts run: DARNLY_UPDATE_MAC=1 npx vitest run src/lib/mac-agent-setup.test.ts
 */
const SWIFT_FILE = resolve(__dirname, '../../mac/Sources/DarnlyCore/AgentSetupText.swift');
const PROJECT_SLOT = 'darnly-project-slot';

/** A Swift string literal: JSON escapes, with \u{…} for the escapes Swift spells differently. */
function swiftString(s: string): string {
  return JSON.stringify(s).replace(/\\u([0-9a-fA-F]{4})/g, '\\u{$1}').replace(/\\[bf]/g, (m) => (m === '\\b' ? '\\u{8}' : '\\u{c}'));
}

function swiftSource(): string {
  const hooks = hookCommands();
  const values: [string, string, string][] = [
    ['agentsBlock', agentsBlock(PROJECT_SLOT), `The AGENTS.md block. "${PROJECT_SLOT}" stands for the project name; its line is dropped when there is none.`],
    ['projectSlot', PROJECT_SLOT, 'Where the project name goes in agentsBlock.'],
    ['agentsMarkerStart', AGENTS_MARKER_START, 'Marks the start of our block in AGENTS.md.'],
    ['agentsMarkerEnd', AGENTS_MARKER_END, 'Marks the end of our block in AGENTS.md.'],
    ['skill', skillMd(), 'The /darnly skill, written to each path in skillPaths.'],
    ['cursorCommand', cursorCommand(), "Cursor's /darnly command."],
    ['cursorCommandPath', CURSOR_COMMAND_PATH, "Where Cursor's command goes."],
    ['hookMark', HOOK_MARK, 'Marks our Claude Code hook commands.'],
    ['sessionStartHook', hooks.sessionStart, 'Claude Code SessionStart hook: tells the agent how many bugs are waiting.'],
    ['promptSubmitHook', hooks.promptSubmit, 'Claude Code UserPromptSubmit hook: tells the agent about bugs captured since it was last told.'],
  ];
  const lines = values.map(([name, value, doc]) => `    /// ${doc}\n    public static let ${name} = ${swiftString(value)}`);
  lines.push(`    /// Where the skill is written (Codex and Cursor read .agents, Claude Code reads .claude).\n    public static let skillPaths = [${SKILL_PATHS.map(swiftString).join(', ')}]`);
  return `// Generated from src/lib/agent-setup.ts by src/lib/mac-agent-setup.test.ts. Do not edit by hand:
// change agent-setup.ts, then run DARNLY_UPDATE_MAC=1 npx vitest run src/lib/mac-agent-setup.test.ts

/// The texts the agent setup writes, the same as the Chrome extension's.
public enum AgentSetupText {
${lines.join('\n\n')}
}
`;
}

describe('Mac agent setup texts', () => {
  it('match agent-setup.ts', () => {
    const want = swiftSource();
    if (process.env.DARNLY_UPDATE_MAC) writeFileSync(SWIFT_FILE, want);
    expect(readFileSync(SWIFT_FILE, 'utf8')).toBe(want);
  });

  it('can drop the project line cleanly', () => {
    const block = agentsBlock(PROJECT_SLOT);
    const withoutLine = block.split('\n').filter((l) => !l.includes(PROJECT_SLOT)).join('\n');
    expect(withoutLine).toBe(agentsBlock());
    expect(block.replaceAll(PROJECT_SLOT, 'maccy')).toBe(agentsBlock('maccy'));
  });
});
