export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // The hotkey opens the side panel and tells the page to start the picker.
  // The picker itself arrives on Wednesday (Sprint 1, day 3).
  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'start-capture' || !tab?.windowId) return;
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'capture-started', tabId: tab.id }).catch(() => {});
  });
});
