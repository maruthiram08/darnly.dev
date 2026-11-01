// /tools/ live search: hides tool cards, empty sections and empty category chips as you type. Browser only.
const input = document.querySelector<HTMLInputElement>('#tool-search');
const status = document.querySelector<HTMLElement>('#search-status');
const none = document.querySelector<HTMLElement>('#no-results');
const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-group]'));
const chips = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-chip]'));

function apply(): void {
  const words = (input?.value ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const group of groups) {
    let inGroup = 0;
    for (const card of Array.from(group.querySelectorAll<HTMLElement>('[data-tool]'))) {
      const text = card.dataset.search ?? '';
      const match = words.every((w) => text.includes(w));
      card.hidden = !match;
      if (match) inGroup++;
    }
    group.hidden = inGroup === 0;
    const chip = chips.find((c) => c.dataset.chip === group.id);
    if (chip) {
      chip.hidden = inGroup === 0;
      const n = chip.querySelector('span');
      if (n) n.textContent = String(inGroup);
    }
    shown += inGroup;
  }
  if (none) none.hidden = shown > 0;
  if (status) status.textContent = words.length === 0 ? '' : `${shown} ${shown === 1 ? 'tool' : 'tools'} found`;
}

if (input) {
  input.addEventListener('input', apply);
  // Press "/" anywhere to jump to the search box.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (e.key === '/' && target && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.isContentEditable) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === 'Escape' && document.activeElement === input && input.value) {
      input.value = '';
      apply();
    }
  });
  // Keep a search typed before the script loaded (or restored by the back button).
  if (input.value) apply();
}
