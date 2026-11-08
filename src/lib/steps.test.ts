// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addStep, cleanStep, cleanSteps, describeTarget, recentSteps, stepText, watchSteps, type Step } from './steps';

beforeEach(() => {
  document.body.innerHTML = `
    <form>
      <label for="email">Email</label><input id="email" type="email" value="me@example.com" />
      <input id="pw" type="password" placeholder="Password" />
      <label><input id="remember" type="checkbox" /> Remember me</label>
      <select id="plan" aria-label="Plan"><option>Free</option><option>Pro</option></select>
      <button type="submit" class="btn primary"><span class="icon"></span><span>Save changes</span></button>
      <a href="#pricing">Pricing</a>
      <div id="card">Order 1234</div>
    </form>`;
});

describe('describeTarget', () => {
  it('names the control a person would name', () => {
    expect(describeTarget(document.querySelector('button span:last-child')!)).toBe('button "Save changes"');
    expect(describeTarget(document.querySelector('#email')!)).toBe('field "Email"');
    expect(describeTarget(document.querySelector('#pw')!)).toBe('field "Password"');
    expect(describeTarget(document.querySelector('#plan')!)).toBe('dropdown "Plan"');
    expect(describeTarget(document.querySelector('a')!)).toBe('link "Pricing"');
    expect(describeTarget(document.querySelector('#card')!)).toBe('div "Order 1234"');
  });

  it("never uses what is typed in a field", () => {
    expect(describeTarget(document.querySelector('#email')!)).not.toContain('me@example.com');
  });
});

describe('watchSteps', () => {
  let stop: () => void = () => {};
  afterEach(() => stop());

  // happy-dom makes dispatched events untrusted; the watcher only counts real user actions, so mark them trusted.
  const trusted = <T extends Event>(e: T): T => (Object.defineProperty(e, 'isTrusted', { value: true }), e);

  it('records clicks, typing (without the words), choices and keys', () => {
    const steps: Omit<Step, 't'>[] = [];
    stop = watchSteps(window, (s) => steps.push(s));
    document.querySelector('button span')!.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    const email = document.querySelector<HTMLInputElement>('#email')!;
    email.value = 'secret@example.com';
    email.dispatchEvent(trusted(new Event('change', { bubbles: true })));
    email.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true }))); // clicks into fields are not steps
    const box = document.querySelector<HTMLInputElement>('#remember')!;
    box.checked = true;
    box.dispatchEvent(trusted(new Event('change', { bubbles: true })));
    const plan = document.querySelector<HTMLSelectElement>('#plan')!;
    plan.selectedIndex = 1;
    plan.dispatchEvent(trusted(new Event('change', { bubbles: true })));
    email.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    document.querySelector('a')!.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));

    expect(steps.map((s) => stepText({ t: 0, ...s }))).toEqual([
      `Opened \`${new URL(location.href).pathname}\``,
      'Clicked button "Save changes" (classes: `btn primary`)',
      'Typed in field "Email"',
      'Ticked checkbox "Remember me"',
      'Chose "Pro" in dropdown "Plan"',
      'Pressed Enter in field "Email"',
      'Clicked link "Pricing"',
    ]);
    expect(JSON.stringify(steps)).not.toContain('secret@example.com');
  });

  it('ignores clicks the page makes by itself', () => {
    const steps: Omit<Step, 't'>[] = [];
    stop = watchSteps(window, (s) => steps.push(s));
    document.querySelector('button')!.click();
    expect(steps.map((s) => s.kind)).toEqual(['page']);
  });
});

describe('addStep', () => {
  it('merges repeated typing in one field and keeps only the last ones', () => {
    let list: Step[] = [];
    list = addStep(list, { t: 1, kind: 'type', target: 'field "Email"' }, 3);
    list = addStep(list, { t: 2, kind: 'type', target: 'field "Email"' }, 3);
    list = addStep(list, { t: 3, kind: 'click', target: 'button "A"' }, 3);
    list = addStep(list, { t: 4, kind: 'click', target: 'button "A"' }, 3); // two real clicks stay two
    list = addStep(list, { t: 5, kind: 'click', target: 'button "B"' }, 3);
    expect(list.map((s) => s.t)).toEqual([3, 4, 5]);
  });
});

describe('cleanStep', () => {
  it('keeps only known kinds and short, redacted strings from the page', () => {
    expect(cleanStep({ kind: 'evil' })).toBeNull();
    expect(cleanStep('nope')).toBeNull();
    const s = cleanStep({ t: 5, kind: 'click', target: 'button "token=abcdef123456"', url: 'http://localhost:3000/a?token=abc12345', shot: 'data:image/jpeg;base64,AAAA' });
    expect(s).toMatchObject({ t: 5, kind: 'click' });
    expect(s!.target).not.toContain('abcdef123456');
    expect(s!.url).not.toContain('abc12345');
    expect(s!.shot).toBeUndefined(); // pictures only from the extension's own recording
    expect(cleanStep({ kind: 'click', shot: 'data:image/jpeg;base64,AAAA' }, true)!.shot).toBe('data:image/jpeg;base64,AAAA');
    expect(cleanStep({ kind: 'click', shot: 'javascript:alert(1)' }, true)!.shot).toBeUndefined();
  });

  it('caps how many steps it takes', () => {
    expect(cleanSteps(Array.from({ length: 100 }, (_, i) => ({ t: i, kind: 'click' })), false, 5).map((s) => s.t)).toEqual([95, 96, 97, 98, 99]);
  });
});

describe('recentSteps', () => {
  it('keeps the last ten from the last five minutes', () => {
    const now = 10 * 60_000;
    const steps: Step[] = Array.from({ length: 15 }, (_, i) => ({ t: now - (14 - i) * 1000, kind: 'click' }));
    steps.unshift({ t: now - 6 * 60_000, kind: 'page', url: 'http://localhost/old' });
    const r = recentSteps(steps, now);
    expect(r).toHaveLength(10);
    expect(r.every((s) => s.kind === 'click')).toBe(true);
  });
});

describe('stepText', () => {
  it('keeps page text from breaking the markdown', () => {
    expect(stepText({ t: 0, kind: 'click', target: 'button "a`b"' })).toBe('Clicked button "a\'b"');
    expect(stepText({ t: 0, kind: 'page', url: 'http://localhost:3000/settings?tab=1' })).toBe('Opened `/settings?tab=1`');
    expect(cleanStep({ kind: 'click', target: 'button "Go"', classes: 'h-10 px-3 hover:text-ember-600`<x>' })!.classes).toBe('h-10 px-3 hover:text-ember-600x');
  });
});
