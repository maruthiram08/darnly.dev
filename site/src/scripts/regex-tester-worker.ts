// Web Worker: matches in the background so a pattern that takes forever can be stopped.
import { run } from './regex-tester-match';

self.onmessage = (e: MessageEvent<{ id: number; pattern: string; flags: string; text: string }>) => {
  const { id, pattern, flags, text } = e.data;
  try {
    self.postMessage({ id, result: run(pattern, flags, text) });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error).message || err) });
  }
};
