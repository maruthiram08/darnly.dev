/**
 * Talk instead of typing (review mode prototype): Chrome's built-in speech recognition, which turns what the
 * user says into the "What did you expect?" note. Chrome sends the audio to its speech service to do this,
 * so it only runs while the user has review mode or the mic button on.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function canTalk(): boolean {
  return !!speechCtor();
}

function speechCtor(): (new () => Recognition) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface TalkHandlers {
  /** The words so far (final + still being heard), to show in the note box as the user talks. */
  onText(text: string): void;
  /** The user stopped talking for `quietMs` after saying something: the note is done. */
  onDone(text: string): void;
  /** "not-allowed" means the panel has no microphone permission yet (see mic.html). */
  onError(error: string): void;
}

/** Starts listening. Returns stop(). Ends on its own after `quietMs` of silence once something was said. */
export function listen(h: TalkHandlers, { quietMs = 1600, lang = navigator.language || 'en-US' } = {}): () => void {
  const Ctor = speechCtor();
  if (!Ctor) {
    h.onError('unsupported');
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let latest = '';
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(quiet);
    rec.stop();
    const text = latest.trim();
    if (text) h.onDone(text);
  };
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    latest = joinSpoken(finalText + interim);
    h.onText(latest);
    clearTimeout(quiet);
    if (latest.trim()) quiet = setTimeout(finish, quietMs);
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    stopped = true;
    clearTimeout(quiet);
    h.onError(e.error);
  };
  // Chrome ends a session after a while even in continuous mode: keep listening until the user is done.
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        finish();
      }
    }
  };
  try {
    rec.start();
  } catch (e) {
    h.onError((e as Error).message);
  }
  return () => {
    stopped = true;
    clearTimeout(quiet);
    rec.abort();
  };
}

/** Spoken text as a note: squashed spaces, first letter capital ("make it blue" -> "Make it blue"). */
export function joinSpoken(t: string): string {
  const s = t.replace(/\s+/g, ' ').trimStart();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
