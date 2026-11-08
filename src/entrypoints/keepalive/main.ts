import { folderAccess, listCaptures, recentFolders } from '@/lib/project-folder';
import { reportOpen } from '@/lib/open-count';

/**
 * Keeps the number on the toolbar icon current while the side panel is closed:
 * once a minute, counts the bugs waiting in each linked project folder Darnly can still read,
 * and asks the background to count the cloud inbox (it does that every few minutes at most).
 * Only reads file names and the first lines of each report, the same as the panel's list.
 */
async function tick() {
  try {
    for (const f of await recentFolders()) {
      if ((await folderAccess(f)) !== 'granted') continue;
      reportOpen(`folder:${f.name}`, await listCaptures(f).catch(() => []));
    }
  } catch {
    /* the badge is a nicety */
  }
  chrome.runtime.sendMessage({ type: 'count-cloud' }).catch(() => {});
}

tick();
setInterval(tick, 60_000);
