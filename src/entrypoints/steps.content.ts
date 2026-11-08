import { isSensitiveField } from '@/lib/element-info';
import { watchSteps } from '@/lib/steps';

/**
 * "Record steps": injected into the tab when the user presses Record in the side panel,
 * and again after each page load while recording is on.
 * Runs walled off from the page (isolated world) and sends each action to the background,
 * which keeps the list and takes a small screenshot after each step. Never reads what was typed
 * (it only checks whether a card number field is filled in, to leave that step without a screenshot).
 *
 * It also shows a small recording bar on the page (step count, Pause, Done, Cancel) and pops up
 * the step's number where the user clicked. Both hide while a screenshot is taken.
 */
export default defineContentScript({
  // Injected on demand with chrome.scripting; this list only keeps WXT from asking for every site.
  matches: ['http://localhost/*'],
  registration: 'runtime',
  main() {
    const w = window as unknown as { __darnlySteps?: boolean };
    if (w.__darnlySteps) return;
    w.__darnlySteps = true;
    const bar = recordingBar();
    let pointer: { x: number; y: number } | null = null;
    let pending = 0;
    const onPointer = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    addEventListener('pointerdown', onPointer, { capture: true, passive: true });

    const stop = watchSteps(window, (step) => {
      if (bar.paused) return;
      // A filled-in card field would show in the step's screenshot, so that step goes without one.
      const noShot = Array.from(document.querySelectorAll('input')).some((i) => isSensitiveField(i) && i.type !== 'password' && i.value);
      const at = step.kind === 'click' ? pointer : null;
      pointer = null;
      // Out of the step's screenshot: hidden until every step sent so far has its picture.
      // Sent at once (not after a frame): a click on a link may unload the page any moment now.
      bar.hide();
      pending++;
      const t = Date.now();
      chrome.runtime.sendMessage({ type: 'step', step: { t, ...step }, noShot }).then(
        (r: { recording?: boolean; count?: number; paused?: boolean } | undefined) => {
          pending--;
          if (r && r.recording === false) return end();
          if (!pending) bar.show();
          if (typeof r?.count === 'number') {
            bar.setCount(r.count);
            if (at && !r.paused) bar.pop(r.count, at);
          }
        },
        () => end(), // the extension was reloaded or removed
      );
    });

    bar.onPause = (paused) => chrome.runtime.sendMessage({ type: 'steps-pause', paused }).catch(() => {});
    bar.onCancel = () => chrome.runtime.sendMessage({ type: 'steps-cancel' }).catch(() => {}).finally(end);
    bar.onDone = () => {
      bar.hide();
      chrome.runtime.sendMessage({ type: 'steps-done' }).catch(() => bar.show());
    };
    chrome.runtime.sendMessage({ type: 'steps-tab-status' }).then(
      (r: { on?: boolean; count?: number; paused?: boolean } | undefined) => {
        if (r?.on === false) return end();
        bar.setCount(r?.count ?? 0);
        bar.setPaused(!!r?.paused);
      },
      () => {},
    );

    // The picker's overlay means a capture is starting: keep the bar out of that screenshot too.
    const watchPicker = new MutationObserver(() => {
      if (document.querySelector('darnly-picker')) bar.hide();
    });
    watchPicker.observe(document.documentElement, { childList: true });

    function end() {
      stop();
      bar.remove();
      watchPicker.disconnect();
      removeEventListener('pointerdown', onPointer, { capture: true });
      w.__darnlySteps = false;
      chrome.runtime.onMessage.removeListener(onMessage);
    }
    const onMessage = (msg: { type?: string; paused?: boolean; count?: number }) => {
      if (msg?.type === 'steps-stop') end();
      if (msg?.type === 'steps-paused') {
        bar.setPaused(!!msg.paused);
        if (typeof msg.count === 'number') bar.setCount(msg.count);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
  },
});

/** The recording bar, in a closed Shadow DOM so the site's CSS can't change it. */
function recordingBar() {
  const host = document.createElement('darnly-steps');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .bar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
        background: #0b1220; color: #fff; font: 500 13px/1.2 system-ui, -apple-system, sans-serif; padding: 7px 8px 7px 14px;
        border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.28); pointer-events: auto; white-space: nowrap; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #e11d48; box-shadow: 0 0 0 0 rgba(225,29,72,.6); animation: pulse 1.4s infinite; }
      .paused .dot { background: #f59e0b; animation: none; }
      @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(225,29,72,.6); } 70% { box-shadow: 0 0 0 8px rgba(225,29,72,0); } 100% { box-shadow: 0 0 0 0 rgba(225,29,72,0); } }
      .label b { font-weight: 700; }
      .hint { color: #9ca3af; }
      button { all: unset; cursor: pointer; font: 600 12px/1 system-ui, -apple-system, sans-serif; padding: 7px 11px; border-radius: 999px; color: #fff; background: rgba(255,255,255,.1); }
      button:hover { background: rgba(255,255,255,.18); }
      button.done { background: #e11d48; }
      button.done:hover { background: #be123c; }
      button.x { padding: 7px 9px; color: #9ca3af; }
      .pop { position: fixed; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; background: #e11d48; color: #fff;
        font: 700 13px/26px system-ui, sans-serif; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: none;
        animation: pop 900ms ease-out forwards; }
      @keyframes pop { 0% { transform: scale(.4); opacity: 0; } 15% { transform: scale(1.1); opacity: 1; } 70% { opacity: 1; } 100% { transform: scale(1) translateY(-10px); opacity: 0; } }
    </style>
    <div class="bar" role="status">
      <span class="dot"></span>
      <span class="label"><b class="state">Recording</b> · <span class="count">0 steps</span> <span class="hint">· what you type is never recorded</span></span>
      <button class="pause" title="Pause recording">Pause</button>
      <button class="done" title="Stop recording and describe the bug">Done</button>
      <button class="x" title="Cancel recording and throw the steps away">✕</button>
    </div>`;
  document.documentElement.appendChild(host);
  const bar = shadow.querySelector<HTMLDivElement>('.bar')!;
  const state = shadow.querySelector<HTMLElement>('.state')!;
  const count = shadow.querySelector<HTMLElement>('.count')!;
  const pause = shadow.querySelector<HTMLButtonElement>('.pause')!;
  const api = {
    paused: false,
    onPause: (_paused: boolean) => {},
    onDone: () => {},
    onCancel: () => {},
    setCount(n: number) {
      count.textContent = `${n} step${n === 1 ? '' : 's'}`;
    },
    setPaused(p: boolean) {
      api.paused = p;
      bar.classList.toggle('paused', p);
      state.textContent = p ? 'Paused' : 'Recording';
      pause.textContent = p ? 'Resume' : 'Pause';
    },
    hide() {
      host.style.display = 'none';
    },
    show() {
      if (!document.querySelector('darnly-picker')) host.style.display = '';
    },
    /** The step's number where the user clicked, for a moment. */
    pop(n: number, at: { x: number; y: number }) {
      const el = document.createElement('div');
      el.className = 'pop';
      el.textContent = String(n);
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      shadow.appendChild(el);
      setTimeout(() => el.remove(), 950);
    },
    remove() {
      host.remove();
    },
  };
  // Keep these clicks from reaching the page (and from being recorded as steps).
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) bar.addEventListener(type, (e) => e.stopPropagation());
  pause.addEventListener('click', (e) => {
    e.stopPropagation();
    api.setPaused(!api.paused);
    api.onPause(api.paused);
  });
  shadow.querySelector('.done')!.addEventListener('click', (e) => {
    e.stopPropagation();
    api.onDone();
  });
  shadow.querySelector('.x')!.addEventListener('click', (e) => {
    e.stopPropagation();
    api.onCancel();
  });
  return api;
}
