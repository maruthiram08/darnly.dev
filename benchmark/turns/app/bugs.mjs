// The 8 bugs planted in Excalidraw, one per run. Half need a fix in a SHARED place (a theme token or a
// shared component) because the same symptom shows up elsewhere; half need a LOCAL fix, where changing
// the shared place would break other things. The user only reports where they noticed it, so the agent
// has to work out the scope: that is the "is this local or global?" question.
//
// Each bug has:
// - note: what the user types (the same words with a screenshot, or into Darnly as the note)
// - scope: 'global' or 'local' (where the right fix is)
// - plant: exact find/replace edits that create the bug in a clean copy
// - capture: how capture.mjs reproduces it (setup) and which element the Darnly user clicks (pick)
// - checks: browser checks run after every agent turn. `main` ones say the reported symptom is gone;
//   the rest check scope. Each has what the user would see on screen, passed or not.
// - user: what the simulated user knows if asked (from looking at the app, never the code)

const PURPLE = 'rgb(105, 101, 219)';
const css = (page, sel, prop) => page.evaluate(([s, p]) => {
  const e = document.querySelector(s);
  if (!e) throw new Error(`${s} not on the page`);
  return getComputedStyle(e).getPropertyValue(p).trim();
}, [sel, prop]);
const expectEq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: ${got} (want ${want})`);
};

// A heading counts as fixed at any normal heading size, not only the original 20px.
const expectAtLeast = (got, min, what) => {
  if (!(parseFloat(got) >= min)) throw new Error(`${what}: ${got} (want at least ${min}px)`);
};

async function openMainMenu(page) {
  await page.locator('.main-menu-trigger').click();
  await page.locator('.dropdown-menu').first().waitFor({ timeout: 5000 });
}

async function drawRectangle(page) {
  await page.keyboard.press('r');
  await page.mouse.move(560, 420);
  await page.mouse.down();
  await page.mouse.move(700, 520, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

const liveElements = (page) => page.evaluate(() => (window.h?.elements ?? []).filter((e) => !e.isDeleted).length);

export const BUGS = [
  {
    id: 'x01-primary-colour',
    kind: 'css',
    scope: 'global',
    note: 'The share button at the top right turned green. It should be purple like before.',
    plant: [{ file: 'packages/excalidraw/css/theme.scss', find: '--color-primary: #6965db;', replace: '--color-primary: #2f9e44;' }],
    capture: { pick: (page) => page.locator('.collab-button') },
    checks: [
      {
        name: 'share button is purple', main: true,
        test: async (page) => expectEq(await css(page, '.collab-button', 'background-color'), PURPLE, 'share button'),
        seenWhenOk: 'The share button at the top right is purple again.',
        seenWhenBroken: 'The share button at the top right is still green.',
      },
      {
        name: 'logo on the start screen is purple too',
        test: async (page) => expectEq(await css(page, '.ExcalidrawLogo-icon', 'color'), PURPLE, 'logo icon'),
        seenWhenOk: 'The logo on the start screen is purple.',
        seenWhenBroken: 'The Excalidraw logo in the middle of the start screen is still green.',
      },
    ],
    user: [
      'You noticed it on the share button at the top right.',
      'If you look around: the Excalidraw logo in the middle of the start screen is green too. Everything that used to be purple seems green.',
      'You want the usual purple back everywhere.',
    ],
  },
  {
    id: 'x02-dialog-title',
    kind: 'css',
    scope: 'global',
    note: 'The title of the Help window is tiny now, smaller than the text under it.',
    plant: [{
      file: 'packages/excalidraw/components/Dialog.scss',
      find: '    text-align: left;\n    font-size: 1.25rem;',
      replace: '    text-align: left;\n    font-size: 0.625rem;',
    }],
    capture: {
      setup: async (page) => {
        await page.locator('.help-icon').click();
        await page.locator('.Dialog__title').waitFor({ timeout: 5000 });
      },
      pick: (page) => page.locator('.Dialog__title').first(),
    },
    checks: [
      {
        name: 'Help window title is big', main: true,
        test: async (page) => {
          await page.locator('.help-icon').click();
          await page.locator('.Dialog__title').waitFor({ timeout: 5000 });
          expectAtLeast(await css(page, '.Dialog__title', 'font-size'), 16, 'Help title size');
        },
        seenWhenOk: 'The Help window title is a normal, big heading again.',
        seenWhenBroken: 'The Help window title is still tiny.',
      },
      {
        name: 'Save to... window title is big too',
        test: async (page) => {
          await openMainMenu(page);
          await page.getByTestId('json-export-button').click();
          await page.locator('.Dialog__title').waitFor({ timeout: 5000 });
          expectAtLeast(await css(page, '.Dialog__title', 'font-size'), 16, 'Save to title size');
        },
        seenWhenOk: 'The "Save to..." window title looks normal.',
        seenWhenBroken: 'The title of the "Save to..." window from the main menu is still tiny too.',
      },
    ],
    user: [
      'You noticed it on the Help window (the ? button at the bottom right).',
      'If you look: the "Save to..." window from the main menu has a tiny title too.',
      'You want the titles big like before.',
    ],
  },
  {
    id: 'x03-zoom-label-faint',
    kind: 'css',
    scope: 'local',
    note: 'The 100% zoom number at the bottom left is so faint I can barely read it.',
    plant: [{
      file: 'packages/excalidraw/components/Actions.scss',
      find: '  justify-content: center;\n  color: var(--text-primary-color);',
      replace: '  justify-content: center;\n  color: var(--color-gray-30);',
    }],
    capture: { pick: (page) => page.locator('.reset-zoom-button') },
    checks: [
      {
        name: 'zoom number is dark', main: true,
        test: async (page) => expectEq(await css(page, '.reset-zoom-button', 'color'), 'rgb(27, 27, 31)', 'zoom label'),
        seenWhenOk: 'The 100% at the bottom left is easy to read now.',
        seenWhenBroken: 'The 100% at the bottom left is still very faint.',
      },
      {
        name: 'other grey text unchanged',
        test: async (page) => {
          expectEq(await css(page, '.excalidraw', '--color-gray-30'), '#d6d6d6', 'gray-30 token');
          expectEq(await css(page, '.excalidraw', '--text-primary-color'), '#1b1b1f', 'text colour token');
          expectEq(await css(page, '.HintViewer', 'color'), 'rgb(184, 184, 184)', 'hint text');
        },
        seenWhenOk: 'The rest of the app looks the same as before.',
        seenWhenBroken: 'Some other text in the app changed colour too, like the hint under the toolbar, and you did not want that.',
      },
    ],
    user: [
      'You only noticed it on the 100% at the bottom left.',
      'Everything else looks normal to you.',
      'It should be dark like the other text.',
    ],
  },
  {
    id: 'x04-reset-canvas',
    kind: 'runtime-error',
    scope: 'local',
    note: "Reset the canvas in the menu doesn't work. I click Confirm and my drawing is still there.",
    plant: [{ file: 'packages/excalidraw/actions/actionCanvas.tsx', find: '    app.imageCache.clear();', replace: '    (app as any).fileCache.clear();' }],
    capture: {
      setup: async (page) => {
        await drawRectangle(page);
        await openMainMenu(page);
        await page.getByTestId('clear-canvas-button').click();
        await page.locator('.confirm-dialog').waitFor({ timeout: 5000 });
        await page.locator('.confirm-dialog').getByRole('button', { name: 'Confirm' }).click();
        await page.waitForTimeout(500);
      },
      pick: (page) => page.locator('.confirm-dialog').getByRole('button', { name: 'Confirm' }),
    },
    checks: [
      {
        name: 'Reset the canvas clears the drawing', main: true,
        test: async (page) => {
          await drawRectangle(page);
          if ((await liveElements(page)) < 1) throw new Error('could not draw a rectangle');
          await openMainMenu(page);
          await page.getByTestId('clear-canvas-button').click();
          await page.locator('.confirm-dialog').getByRole('button', { name: 'Confirm' }).click();
          await page.waitForTimeout(500);
          const n = await liveElements(page);
          if (n) throw new Error(`${n} element(s) still on the canvas`);
        },
        seenWhenOk: 'Reset the canvas works: after Confirm the canvas is empty.',
        seenWhenBroken: 'Reset the canvas still does nothing: after Confirm the drawing is still there.',
      },
    ],
    user: [
      'It happens every time, with any drawing.',
      'The confirm window opens; when you click Confirm, nothing happens and the drawing stays.',
    ],
  },
  {
    id: 'x05-zoom-in',
    kind: 'logic',
    scope: 'local',
    note: 'Clicking + at the bottom left makes everything smaller instead of bigger.',
    plant: [{
      file: 'packages/excalidraw/actions/actionCanvas.tsx',
      find: 'nextZoom: getNormalizedZoom(appState.zoom.value + ZOOM_STEP),',
      replace: 'nextZoom: getNormalizedZoom(appState.zoom.value - ZOOM_STEP),',
    }],
    capture: {
      setup: async (page) => {
        await page.locator('.zoom-in-button').click();
        await page.waitForTimeout(300);
      },
      pick: (page) => page.locator('.zoom-in-button'),
    },
    checks: [
      {
        name: '+ zooms in', main: true,
        test: async (page) => {
          await page.locator('.zoom-in-button').click();
          await page.locator('.reset-zoom-button', { hasText: '110%' }).waitFor({ timeout: 3000 });
        },
        seenWhenOk: 'The + button zooms in now (110%).',
        seenWhenBroken: 'The + button still makes things smaller.',
      },
      {
        name: '− still zooms out',
        test: async (page) => {
          await page.locator('.zoom-out-button').click();
          await page.locator('.reset-zoom-button', { hasText: '90%' }).waitFor({ timeout: 3000 });
        },
        seenWhenOk: 'The − button still zooms out.',
        seenWhenBroken: 'Now the − button is wrong: it does not zoom out any more.',
      },
    ],
    user: [
      'The − button works fine.',
      'Pressing + shows 90%, then 80%.',
    ],
  },
  {
    id: 'x06-square-corners',
    kind: 'css',
    scope: 'global',
    note: 'The toolbar at the top lost its rounded corners, it looks square now.',
    plant: [{ file: 'packages/excalidraw/css/theme.scss', find: '--border-radius-lg: 0.5rem;', replace: '--border-radius-lg: 0;' }],
    capture: { pick: (page) => page.locator('.App-toolbar').first() },
    checks: [
      {
        name: 'toolbar is rounded', main: true,
        test: async (page) => expectEq(await css(page, '.App-toolbar', 'border-radius'), '8px', 'toolbar corners'),
        seenWhenOk: 'The toolbar at the top has rounded corners again.',
        seenWhenBroken: 'The toolbar at the top still has square corners.',
      },
      {
        name: 'zoom box is rounded too',
        test: async (page) => expectEq(await css(page, '.zoom-actions', 'border-radius'), '8px', 'zoom box corners'),
        seenWhenOk: 'The zoom box at the bottom left is rounded.',
        seenWhenBroken: 'The zoom box at the bottom left still has square corners.',
      },
    ],
    user: [
      'You noticed it on the toolbar at the top.',
      'If you look: the zoom box at the bottom left and the menus have square corners too.',
      'You want them all rounded like before.',
    ],
  },
  {
    id: 'x07-menu-hover',
    kind: 'css',
    scope: 'global',
    note: 'When I move the mouse over the items in the main menu, nothing highlights anymore.',
    plant: [{
      file: 'packages/excalidraw/components/dropdownMenu/DropdownMenu.scss',
      find: '      &:hover {\n        background-color: var(--button-hover-bg);\n        text-decoration: none;',
      replace: '      &:hover {\n        background-color: transparent;\n        text-decoration: none;',
    }],
    capture: {
      setup: async (page) => {
        await openMainMenu(page);
        await page.locator('.dropdown-menu .dropdown-menu-item').nth(1).hover();
      },
      pick: (page) => page.locator('.dropdown-menu .dropdown-menu-item').nth(1),
    },
    checks: [
      {
        name: 'main menu item highlights on hover', main: true,
        test: async (page) => {
          await openMainMenu(page);
          const item = page.locator('.dropdown-menu .dropdown-menu-item').nth(1);
          await item.hover();
          await page.waitForTimeout(200);
          expectEq(await item.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(241, 240, 255)', 'hovered item');
        },
        seenWhenOk: 'Main menu items highlight when you hover them.',
        seenWhenBroken: 'Main menu items still do not highlight when you hover them.',
      },
      {
        name: 'More tools menu highlights on hover too',
        test: async (page) => {
          await page.locator('.App-toolbar__extra-tools-trigger').click();
          const item = page.locator('.dropdown-menu .dropdown-menu-item').nth(1);
          await item.waitFor({ timeout: 5000 });
          await item.hover();
          await page.waitForTimeout(200);
          expectEq(await item.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(241, 240, 255)', 'hovered item');
        },
        seenWhenOk: 'The More tools menu (⋮ in the toolbar) highlights on hover.',
        seenWhenBroken: 'The More tools menu (⋮ in the toolbar) still does not highlight on hover.',
      },
    ],
    user: [
      'You noticed it in the main menu (the ☰ button at the top left).',
      'If you look: the menu behind the ⋮ More tools button in the toolbar does not highlight either.',
      'It used to show a light purple highlight.',
    ],
  },
  {
    id: 'x08-hint-size',
    kind: 'css',
    scope: 'local',
    note: 'The hint text under the toolbar is huge now and covers the canvas.',
    plant: [{
      file: 'packages/excalidraw/components/HintViewer.scss',
      find: '    color: var(--color-gray-40);\n    font-size: 0.75rem;',
      replace: '    color: var(--color-gray-40);\n    font-size: 1.75rem;',
    }],
    capture: { pick: (page) => page.locator('.HintViewer span').first() },
    checks: [
      {
        name: 'hint text is small', main: true,
        test: async (page) => expectEq(await css(page, '.HintViewer', 'font-size'), '12px', 'hint size'),
        seenWhenOk: 'The hint under the toolbar is small again.',
        seenWhenBroken: 'The hint under the toolbar is still huge.',
      },
      {
        name: 'other text sizes unchanged',
        test: async (page) => {
          expectEq(await css(page, '.reset-zoom-button', 'font-size'), '14px', 'zoom label size');
          expectEq(await css(page, '.excalidraw', 'font-size'), '16px', 'base text size');
        },
        seenWhenOk: 'The rest of the text looks the same as before.',
        seenWhenBroken: 'Other text in the app changed size too, and you did not want that.',
      },
    ],
    user: [
      'Only that hint text is big; the rest looks normal.',
      'It should be small, like it was.',
    ],
  },
];
