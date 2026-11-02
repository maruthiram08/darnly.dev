import { describe, expect, it } from 'vitest';
import { cleanProjectName, suggestProjectName } from './project-name';

describe('suggestProjectName', () => {
  it('uses the site name for live sites', () => {
    expect(suggestProjectName('https://www.counterdraft.com/workspace?tab=x')).toBe('counterdraft');
    expect(suggestProjectName('https://darnly.dev/tools/')).toBe('darnly');
    expect(suggestProjectName('https://app.acme.co.uk/')).toBe('acme');
  });
  it('uses the page title on localhost, then the port', () => {
    expect(suggestProjectName('http://localhost:3000/plans', 'Acme Planner — This week')).toBe('acme-planner');
    expect(suggestProjectName('http://localhost:3000/plans', '')).toBe('localhost-3000');
  });
  it('cleans names', () => {
    expect(cleanProjectName('  My App! ')).toBe('my-app');
  });
});
