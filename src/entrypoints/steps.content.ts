import { isSensitiveField } from '@/lib/element-info';
import { watchSteps } from '@/lib/steps';

/**
 * "Record steps": injected into the tab when the user presses Record in the side panel,
 * and again after each page load while recording is on.
 * Runs walled off from the page (isolated world) and sends each action to the background,
 * which keeps the list and takes a small screenshot after each step. Never reads what was typed
 * (it only checks whether a card number field is filled in, to leave that step without a screenshot).
 */
export default defineContentScript({
  // Injected on demand with chrome.scripting; this list only keeps WXT from asking for every site.
  matches: ['http://localhost/*'],
  registration: 'runtime',
  main() {
    const w = window as unknown as { __darnlySteps?: boolean };
    if (w.__darnlySteps) return;
    w.__darnlySteps = true;
    const stop = watchSteps(window, (step) => {
      // A filled-in card field would show in the step's screenshot, so that step goes without one.
      const noShot = Array.from(document.querySelectorAll('input')).some((i) => isSensitiveField(i) && i.type !== 'password' && i.value);
      chrome.runtime.sendMessage({ type: 'step', step: { t: Date.now(), ...step }, noShot }).then(
        (r: { recording?: boolean } | undefined) => {
          if (r && r.recording === false) end();
        },
        () => end(), // the extension was reloaded or removed
      );
    });
    const end = () => {
      stop();
      w.__darnlySteps = false;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === 'steps-stop') end();
    };
    chrome.runtime.onMessage.addListener(onMessage);
  },
});
