// The side panel can't show Chrome's microphone prompt, so this tab asks once. After "Allow", the panel can listen.
const status = document.getElementById('status')!;
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    stream.getTracks().forEach((t) => t.stop());
    status.className = 'ok';
    status.textContent = 'Done. Go back to the Darnly panel and talk. This tab closes in a moment.';
    chrome.runtime.sendMessage({ type: 'mic-allowed' }).catch(() => {});
    setTimeout(() => window.close(), 1500);
  })
  .catch(() => {
    status.className = 'bad';
    status.textContent = 'The microphone is blocked. Click the icon at the right of the address bar, choose Allow, then reload this tab.';
  });
