import { describe, expect, it } from 'vitest';
import { reopenedReport } from '@/lib/project-folder';

describe('reopenedReport', () => {
  it("drops the agent's Fixed, Won't fix and Working lines, and keeps the rest", () => {
    const md = "# Bug\n\n**Expected:** Pay now should work\n**Fixed:** wired onClick in Pay.tsx\n\nEnd your **Fixed:** line with (checked).\n";
    expect(reopenedReport(md)).toBe('# Bug\n\n**Expected:** Pay now should work\n\nEnd your **Fixed:** line with (checked).\n');
    expect(reopenedReport("**Expected:** x\n**Won’t fix:** not a bug\n**Working on it:** Codex, 10:00\nrest")).toBe('**Expected:** x\nrest');
    expect(reopenedReport("**Expected:** x\n**Won't fix:** not a bug")).toBe('**Expected:** x\n');
  });
});
