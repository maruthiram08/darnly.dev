import { useEffect, useState } from 'react';
import { PRODUCT, INBOX_FOLDER } from '@/config/product';

export function App() {
  const [note, setNote] = useState('');
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    document.title = PRODUCT.NAME;
    const listener = (msg: { type?: string }) => {
      if (msg.type === 'capture-started') setCapturing(true);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <main className="p-4 text-sm text-gray-900">
      <h1 className="text-base font-semibold">{PRODUCT.NAME}</h1>
      <p className="mt-1 text-gray-600">
        {capturing ? 'Click the broken part of the page.' : 'Press Alt+Shift+B on any page to capture a bug.'}
      </p>
      <label className="mt-4 block font-medium" htmlFor="note">What did you expect?</label>
      <textarea
        id="note"
        className="mt-1 w-full rounded-lg border border-gray-300 p-2"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Clicking Pay now should open the payment form"
      />
      <p className="mt-4 text-xs text-gray-500">Captures are saved to {INBOX_FOLDER}/ in your project.</p>
    </main>
  );
}
