// Git undo helper: the situations, their before/after commit graphs, and the commands.
// Static, curated content. Nothing here talks to a server.

export type Danger = 'safe' | 'careful' | 'destroys';

// How a commit dot is drawn.
// plain: an ordinary commit. focus: the commit this is about. agent: a commit your AI agent made.
// bad: contains something it shouldn't (like .env). new: made by the fix. gone: no longer on any branch.
// kept: still saved (on a backup branch) but not on yours any more.
export type Tone = 'plain' | 'focus' | 'agent' | 'bad' | 'new' | 'gone' | 'kept';

export type Commit = {
  id: string;
  col: number;
  lane?: number;
  msg: string;
  parents?: string[];
  tone?: Tone;
};

// A branch label. `here` marks the branch you're on (git's HEAD). `remote` is GitHub's copy.
export type Ref = { name: string; at: string; here?: boolean; remote?: boolean };

// The box next to a commit for files that aren't committed.
export type Work = { at: string; text: string; tone: 'changes' | 'staged' | 'conflict' | 'gone' | 'stash' | 'ok' };

export type Graph = { commits: Commit[]; refs: Ref[]; work?: Work; caption: string };

// A step: a command with a plain-words note, or (no cmd) something you do by hand.
export type Step = { cmd?: string; note: string };

export type Situation = {
  id: string;
  group: string;
  top?: boolean;
  title: string;
  goal: string; // used in the agent prompt
  danger: Danger;
  why: string; // why it has this danger level
  summary: string;
  before: Graph;
  after: Graph;
  steps: Step[];
  notes?: string[];
  links?: { href: string; text: string }[];
};

export const GROUPS = ['Commits', 'Unsaved changes', 'Branches and syncing', 'Secrets and big files'];

export const DANGER: Record<Danger, { label: string; icon: string }> = {
  safe: { label: 'Safe', icon: '✓' },
  careful: { label: 'Be careful', icon: '!' },
  destroys: { label: 'Destroys work', icon: '✕' },
};

const LEAK = { href: '/tools/api-key-leak-checker/', text: 'Check your live site for leaked keys' };
const IGNORE = { href: '/tools/gitignore-generator/', text: 'Make a .gitignore that keeps secrets out' };

export const SITUATIONS: Situation[] = [
  {
    id: 'wrong-branch',
    group: 'Commits',
    top: true,
    title: 'I committed to the wrong branch',
    goal: 'I made a commit on main that should have gone on a new branch. Move it to a new branch and put main back to how it was',
    danger: 'careful',
    why: 'Moves main back one commit. Fine as long as you haven’t pushed main yet.',
    summary: 'Make a new branch where you are, so it keeps your commit, then move main back one step.',
    before: {
      caption: 'Your commit landed on main',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'new feature', parents: ['b'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
    },
    after: {
      caption: 'It’s on its own branch, main is clean',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, lane: 1, msg: 'new feature', parents: ['b'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'b' },
        { name: 'new-feature', at: 'c', here: true },
      ],
    },
    steps: [
      { cmd: 'git switch -c new-feature', note: 'Make a new branch right here. It keeps your commit.' },
      { cmd: 'git switch main', note: 'Go back to main.' },
      { cmd: 'git reset --keep HEAD~1', note: 'Move main back one commit. --keep stops instead of losing any unsaved changes.' },
      { cmd: 'git switch new-feature', note: 'Carry on working on your new branch.' },
    ],
    notes: [
      'Made more than one commit on main? Change HEAD~1 to HEAD~2, HEAD~3 and so on.',
      'Already pushed main? Skip the reset. Make the branch, then use “Undo a commit I already pushed” on main.',
    ],
  },
  {
    id: 'wrong-branch-existing',
    group: 'Commits',
    title: 'I committed to the wrong branch (the right one exists)',
    goal: 'I made a commit on main that belongs on my existing branch my-feature. Copy it there and take it off main',
    danger: 'careful',
    why: 'Moves main back one commit. Fine as long as you haven’t pushed main yet.',
    summary: 'Copy the commit onto the right branch with cherry-pick, then take it off the wrong one.',
    before: {
      caption: 'The fix went on main, not my-feature',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'start feature', parents: ['a'] },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'fix button', parents: ['b'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'c', here: true },
        { name: 'my-feature', at: 'f' },
      ],
    },
    after: {
      caption: 'A copy is on my-feature, main is clean',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'start feature', parents: ['a'] },
        { id: 'g', col: 2, lane: 1, msg: 'fix button', parents: ['f'], tone: 'new' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'fix button', parents: ['b'], tone: 'gone' },
      ],
      refs: [
        { name: 'main', at: 'b' },
        { name: 'my-feature', at: 'g', here: true },
      ],
    },
    steps: [
      { cmd: 'git log --oneline -1', note: 'Shows your last commit. Copy its id (the short code at the start).' },
      { cmd: 'git switch my-feature', note: 'Go to the branch it belongs on.' },
      { cmd: 'git cherry-pick <commit-id>', note: 'Copy that commit onto this branch.' },
      { cmd: 'git switch main', note: 'Go back to the wrong branch.' },
      { cmd: 'git reset --keep HEAD~1', note: 'Take the commit off main.' },
      { cmd: 'git switch my-feature', note: 'Back to work.' },
    ],
    notes: ['Already pushed main? Don’t reset it. After the cherry-pick, use “Undo a commit I already pushed” on main instead.'],
  },
  {
    id: 'undo-last-keep',
    group: 'Commits',
    top: true,
    title: 'Undo my last commit but keep the changes',
    goal: 'Undo my last commit but keep all of its changes in my files so I can redo it',
    danger: 'safe',
    why: 'The commit goes away, but every change in it stays in your files.',
    summary: 'A soft reset takes the commit back. Your files don’t change, and the changes wait to be committed again.',
    before: {
      caption: 'You committed too soon',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'half done', parents: ['b'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
    },
    after: {
      caption: 'Commit undone, changes still in your files',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'changes kept', tone: 'staged' },
    },
    steps: [
      { cmd: 'git reset --soft HEAD~1', note: 'Undo the last commit. Its changes stay, ready to commit again.' },
      { cmd: 'git restore --staged .', note: 'Optional: also unstage them. Your files still don’t change.' },
    ],
    notes: ['Already pushed that commit? Use “Undo a commit I already pushed” instead, so you don’t rewrite what others have.'],
  },
  {
    id: 'fix-message',
    group: 'Commits',
    title: 'Fix the message of my last commit',
    goal: 'Change the message of my last commit',
    danger: 'safe',
    why: 'Only the message changes. Nothing in your files is touched.',
    summary: 'Amend replaces the last commit with the same changes and a new message.',
    before: {
      caption: 'Typo in the message',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'fxi hedaer', parents: ['b'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
    },
    after: {
      caption: 'Same changes, better message',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'Fix header', parents: ['b'], tone: 'new' },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
    },
    steps: [{ cmd: 'git commit --amend -m "Your new message"', note: 'Replace the last commit’s message.' }],
    notes: ['If you already pushed it, GitHub still has the old one and git push will be rejected. It’s usually fine to leave the old message.'],
  },
  {
    id: 'forgot-file',
    group: 'Commits',
    title: 'I forgot a file in my last commit',
    goal: 'Add a file I forgot to my last commit, without making a new commit',
    danger: 'safe',
    why: 'Adds to the last commit. Nothing is deleted.',
    summary: 'Stage the file, then amend the last commit so it’s included.',
    before: {
      caption: 'One file didn’t make it in',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'login page', parents: ['a'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'forgotten file', tone: 'changes' },
    },
    after: {
      caption: 'The commit now has the file',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'login page', parents: ['a'], tone: 'new' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'nothing left', tone: 'ok' },
    },
    steps: [
      { cmd: 'git add path/to/file', note: 'Stage the file you forgot.' },
      { cmd: 'git commit --amend --no-edit', note: 'Put it into the last commit and keep the same message.' },
    ],
    notes: ['Already pushed? Just make a normal new commit with the file instead.'],
  },
  {
    id: 'squash',
    group: 'Commits',
    title: 'Squash my last few commits into one',
    goal: 'Combine my last 3 commits into one commit with a clear message',
    danger: 'careful',
    why: 'Rewrites your history. Only do it on commits you haven’t pushed.',
    summary: 'Soft reset back past the commits (your files don’t change), then commit once.',
    before: {
      caption: 'Three messy commits',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'wip', parents: ['a'], tone: 'focus' },
        { id: 'c', col: 2, msg: 'wip 2', parents: ['b'], tone: 'focus' },
        { id: 'd', col: 3, msg: 'fix it', parents: ['c'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'd', here: true }],
    },
    after: {
      caption: 'One clean commit',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'e', col: 1, msg: 'Add login', parents: ['a'], tone: 'new' },
      ],
      refs: [{ name: 'main', at: 'e', here: true }],
    },
    steps: [
      { cmd: 'git reset --soft HEAD~3', note: 'Undo the last 3 commits but keep all their changes. Use the number of commits you want to combine.' },
      { cmd: 'git commit -m "Add login"', note: 'Commit everything as one.' },
    ],
  },
  {
    id: 'undo-pushed',
    group: 'Commits',
    top: true,
    title: 'Undo a commit I already pushed',
    goal: 'Undo a commit that is already pushed to GitHub, without rewriting history',
    danger: 'safe',
    why: 'Adds a new commit that cancels the old one. History stays as it is.',
    summary: 'Revert makes a new commit that does the exact opposite of the bad one. Safe for shared branches.',
    before: {
      caption: 'A bad commit is on GitHub',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'broke nav', parents: ['b'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'c', here: true },
        { name: 'origin/main', at: 'c', remote: true },
      ],
    },
    after: {
      caption: 'A new commit cancels it out',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'broke nav', parents: ['b'], tone: 'focus' },
        { id: 'd', col: 3, msg: 'Revert it', parents: ['c'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'd', here: true },
        { name: 'origin/main', at: 'd', remote: true },
      ],
    },
    steps: [
      { cmd: 'git log --oneline -5', note: 'Find the bad commit and copy its id.' },
      { cmd: 'git revert <commit-id>', note: 'Make a new commit that undoes it. Save and close the message editor if one opens.' },
      { cmd: 'git push', note: 'Send the fix to GitHub.' },
    ],
    notes: ['Reverting a merge commit? Use git revert -m 1 <commit-id>.'],
  },
  {
    id: 'agent-mess',
    group: 'Commits',
    top: true,
    title: 'The agent made a mess, go back to yesterday',
    goal: 'My AI agent broke things. Put my project back to the last commit from before today, but keep a backup of the current state in case I want something from it',
    danger: 'careful',
    why: 'Resets your branch. The first two steps save a backup, so nothing is really lost.',
    summary: 'Save everything on a backup branch first, then reset your branch to the last good commit.',
    before: {
      caption: 'Agent commits and changes on top',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'yesterday', parents: ['a'] },
        { id: 'c', col: 2, msg: 'agent: refactor', parents: ['b'], tone: 'agent' },
        { id: 'd', col: 3, msg: 'agent: fix', parents: ['c'], tone: 'agent' },
      ],
      refs: [{ name: 'main', at: 'd', here: true }],
      work: { at: 'd', text: 'more changes', tone: 'changes' },
    },
    after: {
      caption: 'Back to yesterday, mess saved aside',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'yesterday', parents: ['a'] },
        { id: 'c', col: 2, lane: 1, msg: 'agent: refactor', parents: ['b'], tone: 'kept' },
        { id: 'd', col: 3, lane: 1, msg: 'agent: fix', parents: ['c'], tone: 'kept' },
        { id: 'e', col: 4, lane: 1, msg: 'before undo', parents: ['d'], tone: 'kept' },
      ],
      refs: [
        { name: 'main', at: 'b', here: true },
        { name: 'backup-before-undo', at: 'e' },
      ],
    },
    steps: [
      { cmd: 'git add -A && git commit -m "Before undo"', note: 'Save everything as it is now. If it says “nothing to commit”, that’s fine.' },
      { cmd: 'git branch backup-before-undo', note: 'Bookmark this state so you can always come back.' },
      { cmd: 'git log --oneline --before=midnight -5', note: 'Lists the last commits made before today. Copy the id of the one that worked.' },
      { cmd: 'git reset --hard <commit-id>', note: 'Put your branch and files back to that commit.' },
    ],
    notes: [
      'Changed your mind? git reset --hard backup-before-undo brings it all back.',
      'Need one file from the mess? git restore --source=backup-before-undo path/to/file',
      'Already pushed the agent’s commits? Instead of reset, run git revert --no-commit <commit-id>..HEAD then git commit -m "Go back to yesterday", and push.',
    ],
  },

  // ---- Unsaved changes ----
  {
    id: 'discard-all',
    group: 'Unsaved changes',
    top: true,
    title: 'Throw away all my changes',
    goal: 'Throw away every change since my last commit, including new files, and go back to exactly my last commit',
    danger: 'destroys',
    why: 'Uncommitted changes and new files are deleted for good. Git can’t bring them back.',
    summary: 'Reset your files to the last commit, then delete new files git doesn’t know about yet.',
    before: {
      caption: 'Changes you don’t want',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last good', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'edits + new files', tone: 'changes' },
    },
    after: {
      caption: 'Exactly your last commit',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last good', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'deleted for good', tone: 'gone' },
    },
    steps: [
      { cmd: 'git reset --hard', note: 'Undo every change to files git already tracks.' },
      { cmd: 'git clean -nd', note: 'Preview: lists the new files and folders that the next step deletes. Deletes nothing.' },
      { cmd: 'git clean -fd', note: 'Delete those new files and folders.' },
    ],
    notes: [
      'Want a safety net? Run git stash -u instead. Your folder is just as clean, and git stash pop brings everything back.',
      'Your .env and other ignored files are safe: git clean -fd leaves them alone.',
    ],
  },
  {
    id: 'discard-file',
    group: 'Unsaved changes',
    title: 'Undo my changes to one file',
    goal: 'Throw away my uncommitted changes to one file and put it back to how it was in the last commit',
    danger: 'destroys',
    why: 'Your uncommitted changes to that file are gone for good.',
    summary: 'Restore puts one file back the way it was in your last commit. Every other file is left alone.',
    before: {
      caption: 'One file went wrong',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last good', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'page.tsx broken', tone: 'changes' },
    },
    after: {
      caption: 'That file is back, others untouched',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last good', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'page.tsx restored', tone: 'ok' },
    },
    steps: [{ cmd: 'git restore path/to/file', note: 'Put that file back to your last commit.' }],
    notes: ['A brand new file git has never seen? Just delete it.'],
  },
  {
    id: 'stash',
    group: 'Unsaved changes',
    title: 'Put my changes aside for a moment',
    goal: 'Put my uncommitted changes aside so I have a clean folder, then bring them back later',
    danger: 'safe',
    why: 'Your changes are saved in the stash. Nothing is lost.',
    summary: 'Stash saves your changes and cleans your folder. Pop brings them back.',
    before: {
      caption: 'Half-done work in the way',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last commit', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'half-done work', tone: 'changes' },
    },
    after: {
      caption: 'Clean folder, work saved in the stash',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last commit', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'saved in stash', tone: 'stash' },
    },
    steps: [
      { cmd: 'git stash -u', note: 'Save your changes (new files too) and clean your folder.' },
      { note: 'Do what you need: switch branch, pull, test something.' },
      { cmd: 'git stash pop', note: 'Bring your changes back.' },
    ],
    notes: ['git stash list shows everything you’ve stashed.'],
  },
  {
    id: 'unstage',
    group: 'Unsaved changes',
    title: 'I added a file I didn’t mean to (not committed)',
    goal: 'Unstage a file I added with git add by mistake, without changing the file',
    danger: 'safe',
    why: 'Only takes the file out of the next commit. The file doesn’t change.',
    summary: 'Restore --staged takes a file out of the next commit and leaves it as it is.',
    before: {
      caption: 'Too many files staged',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last commit', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: '3 files staged', tone: 'staged' },
    },
    after: {
      caption: 'Only the files you want',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'last commit', parents: ['a'] },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: '2 staged, 1 not', tone: 'staged' },
    },
    steps: [
      { cmd: 'git restore --staged path/to/file', note: 'Take that file out of the next commit. Use . for all files.' },
      { cmd: 'git status', note: 'Check: it’s now under “not staged”.' },
    ],
  },
  {
    id: 'restore-deleted',
    group: 'Unsaved changes',
    title: 'Bring back a file I deleted',
    goal: 'Bring back a file that was deleted, either not committed yet or deleted in an earlier commit',
    danger: 'safe',
    why: 'Only brings a file back. Nothing else changes.',
    summary: 'Git still has the file in your last commit, or in the commit before the one that deleted it.',
    before: {
      caption: 'A file is missing',
      commits: [
        { id: 'a', col: 0, msg: 'add logo' },
        { id: 'b', col: 1, msg: 'clean up', parents: ['a'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'logo.svg missing', tone: 'gone' },
    },
    after: {
      caption: 'Back from git’s history',
      commits: [
        { id: 'a', col: 0, msg: 'add logo' },
        { id: 'b', col: 1, msg: 'clean up', parents: ['a'], tone: 'focus' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: 'logo.svg is back', tone: 'ok' },
    },
    steps: [
      { cmd: 'git restore path/to/file', note: 'If you haven’t committed the delete yet, this is all you need.' },
      { cmd: 'git log --oneline -- path/to/file', note: 'Deleted in a commit? The top line is the commit that deleted it. Copy its id.' },
      { cmd: 'git restore --source=<commit-id>~1 path/to/file', note: 'Bring the file back from just before that commit.' },
    ],
  },
  {
    id: 'old-file-version',
    group: 'Unsaved changes',
    title: 'Get an older version of one file',
    goal: 'Put one file back to how it was in an older commit, without touching any other file',
    danger: 'careful',
    why: 'Replaces that file. Commit or stash your current version first if you want to keep it.',
    summary: 'Pick the commit that had the good version, and restore just that file from it.',
    before: {
      caption: 'header.tsx was better before',
      commits: [
        { id: 'a', col: 0, msg: 'good header', tone: 'focus' },
        { id: 'b', col: 1, msg: 'redesign', parents: ['a'] },
        { id: 'c', col: 2, msg: 'more tweaks', parents: ['b'] },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
    },
    after: {
      caption: 'Old header.tsx, everything else current',
      commits: [
        { id: 'a', col: 0, msg: 'good header', tone: 'focus' },
        { id: 'b', col: 1, msg: 'redesign', parents: ['a'] },
        { id: 'c', col: 2, msg: 'more tweaks', parents: ['b'] },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
      work: { at: 'c', text: 'old header.tsx', tone: 'changes' },
    },
    steps: [
      { cmd: 'git log --oneline -- path/to/file', note: 'Every commit that changed this file. Copy the id of the good one.' },
      { cmd: 'git restore --source=<commit-id> path/to/file', note: 'Bring that version back. Commit it if you like it.' },
    ],
  },

  // ---- Branches and syncing ----
  {
    id: 'behind-main',
    group: 'Branches and syncing',
    top: true,
    title: 'My branch is behind main',
    goal: 'Bring the latest changes from main into my branch',
    danger: 'safe',
    why: 'Adds main’s new commits to your branch. Nothing is removed.',
    summary: 'Fetch the latest main from GitHub and merge it into your branch.',
    before: {
      caption: 'main moved on without you',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'my work', parents: ['a'], tone: 'focus' },
        { id: 'b', col: 1, msg: 'their fix', parents: ['a'] },
        { id: 'c', col: 2, msg: 'their page', parents: ['b'] },
      ],
      refs: [
        { name: 'main', at: 'c' },
        { name: 'my-branch', at: 'f', here: true },
      ],
    },
    after: {
      caption: 'Your branch has main’s changes',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'my work', parents: ['a'], tone: 'focus' },
        { id: 'b', col: 1, msg: 'their fix', parents: ['a'] },
        { id: 'c', col: 2, msg: 'their page', parents: ['b'] },
        { id: 'm', col: 3, lane: 1, msg: 'merge main', parents: ['f', 'c'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'c' },
        { name: 'my-branch', at: 'm', here: true },
      ],
    },
    steps: [
      { cmd: 'git fetch origin', note: 'Get the latest from GitHub. Changes nothing in your files.' },
      { cmd: 'git merge origin/main', note: 'Bring main into your branch. Save and close the message editor if one opens.' },
      { note: 'Says CONFLICT? See “I’m in a merge conflict”.' },
      { cmd: 'git push', note: 'Send your updated branch to GitHub.' },
    ],
    notes: ['Main branch called master? Use origin/master.'],
  },
  {
    id: 'merge-conflict',
    group: 'Branches and syncing',
    top: true,
    title: 'I’m in a merge conflict',
    goal: 'Resolve the merge conflict I’m in. Show me each conflict and what both sides changed before picking',
    danger: 'safe',
    why: 'You decide what to keep. And you can always back out with --abort.',
    summary: 'Both sides changed the same lines. Pick what to keep in each file, then finish the merge.',
    before: {
      caption: 'Both branches changed the same lines',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'my header', parents: ['a'], tone: 'focus' },
        { id: 'b', col: 1, msg: 'their header', parents: ['a'] },
      ],
      refs: [
        { name: 'main', at: 'b' },
        { name: 'my-branch', at: 'f', here: true },
      ],
      work: { at: 'f', text: 'CONFLICT', tone: 'conflict' },
    },
    after: {
      caption: 'Merged, with the lines you chose',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'my header', parents: ['a'], tone: 'focus' },
        { id: 'b', col: 1, msg: 'their header', parents: ['a'] },
        { id: 'm', col: 2, lane: 1, msg: 'merged', parents: ['f', 'b'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'b' },
        { name: 'my-branch', at: 'm', here: true },
      ],
    },
    steps: [
      { cmd: 'git status', note: 'Files under “both modified” have conflicts.' },
      { note: 'Open each one. Find the lines between <<<<<<< and >>>>>>>. Keep what you want, and delete the marker lines.' },
      { cmd: 'git add path/to/file', note: 'Mark that file as fixed. Do this for each one.' },
      { cmd: 'git commit --no-edit', note: 'Finish the merge.' },
    ],
    notes: [
      'Scared? git merge --abort puts everything back to how it was before the merge.',
      'In the middle of a rebase instead? Use git rebase --continue to finish, or git rebase --abort to back out.',
    ],
  },
  {
    id: 'push-rejected',
    group: 'Branches and syncing',
    title: 'git push was rejected',
    goal: 'My git push was rejected because GitHub has commits I don’t have. Get them and push again without losing anyone’s work',
    danger: 'safe',
    why: 'Puts your commits after theirs. Nothing is lost on either side.',
    summary: 'GitHub has commits you don’t. Pull them in first, with your commits on top, then push.',
    before: {
      caption: 'GitHub has a commit you don’t',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'r', col: 1, lane: 1, msg: 'their commit', parents: ['a'] },
        { id: 'l', col: 1, msg: 'my commit', parents: ['a'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'l', here: true },
        { name: 'origin/main', at: 'r', remote: true },
      ],
    },
    after: {
      caption: 'Yours on top of theirs, pushed',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'r', col: 1, msg: 'their commit', parents: ['a'] },
        { id: 'l', col: 2, msg: 'my commit', parents: ['r'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'l', here: true },
        { name: 'origin/main', at: 'l', remote: true },
      ],
    },
    steps: [
      { cmd: 'git pull --rebase', note: 'Get their commits and put yours on top.' },
      { note: 'Says CONFLICT? Fix the files, git add them, then run git rebase --continue.' },
      { cmd: 'git push', note: 'Now it goes through.' },
    ],
    notes: ['Never fix this with git push --force. It deletes their commits from GitHub.'],
  },
  {
    id: 'detached-head',
    group: 'Branches and syncing',
    title: 'Git says “detached HEAD”',
    goal: 'Git says I’m in detached HEAD. Keep any work I did there on a branch, and get me back to normal',
    danger: 'safe',
    why: 'Just gives your work a branch name, or goes back to one.',
    summary: 'You’re on a commit, not a branch. Give it a branch name so nothing gets lost, or switch back.',
    before: {
      caption: 'Work on a commit with no branch',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'old version', parents: ['a'] },
        { id: 'c', col: 2, msg: 'latest', parents: ['b'] },
        { id: 'd', col: 2, lane: 1, msg: 'my try', parents: ['b'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'c' },
        { name: 'HEAD (no branch)', at: 'd', here: true },
      ],
    },
    after: {
      caption: 'Your work has a branch',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'old version', parents: ['a'] },
        { id: 'c', col: 2, msg: 'latest', parents: ['b'] },
        { id: 'd', col: 2, lane: 1, msg: 'my try', parents: ['b'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'c' },
        { name: 'saved-work', at: 'd', here: true },
      ],
    },
    steps: [
      { cmd: 'git switch -c saved-work', note: 'Put a branch on where you are, so anything you did here is kept.' },
      { cmd: 'git switch main', note: 'Go back to main. If you didn’t change anything, this step alone is enough.' },
    ],
  },
  {
    id: 'deleted-branch',
    group: 'Branches and syncing',
    title: 'I deleted a branch by mistake',
    goal: 'Bring back a branch called my-feature that I deleted by mistake',
    danger: 'safe',
    why: 'Only adds a branch name back. Nothing is changed or deleted.',
    summary: 'The commits are still there for a while. Find the last one and put the branch name back on it.',
    before: {
      caption: 'The branch name is gone',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'f', col: 1, lane: 1, msg: 'feature', parents: ['a'], tone: 'gone' },
        { id: 'g', col: 2, lane: 1, msg: 'feature 2', parents: ['f'], tone: 'gone' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
    },
    after: {
      caption: 'It’s back',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'f', col: 1, lane: 1, msg: 'feature', parents: ['a'], tone: 'new' },
        { id: 'g', col: 2, lane: 1, msg: 'feature 2', parents: ['f'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'b', here: true },
        { name: 'my-feature', at: 'g' },
      ],
    },
    steps: [
      { cmd: 'git reflog', note: 'Everywhere you’ve been. Find the last line that mentions the branch and copy its id. The delete message “(was 1a2b3c4)” also has it.' },
      { cmd: 'git branch my-feature <commit-id>', note: 'Put the branch back.' },
    ],
    notes: ['Was it pushed to GitHub? Even easier: git switch my-feature brings it back from there.'],
  },
  {
    id: 'lost-commits',
    group: 'Branches and syncing',
    title: 'I reset and lost my commits',
    goal: 'I ran git reset and my recent commits disappeared. Find them with the reflog and get them back',
    danger: 'safe',
    why: 'Git keeps lost commits for weeks. This only bookmarks them.',
    summary: 'The reflog remembers every place your branch has been. Find the commit before the reset and bookmark it.',
    before: {
      caption: 'Two commits vanished',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'login', parents: ['b'], tone: 'gone' },
        { id: 'd', col: 3, msg: 'signup', parents: ['c'], tone: 'gone' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
    },
    after: {
      caption: 'Found and back on your branch',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'c', col: 2, msg: 'login', parents: ['b'], tone: 'new' },
        { id: 'd', col: 3, msg: 'signup', parents: ['c'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'd', here: true },
        { name: 'rescue', at: 'd' },
      ],
    },
    steps: [
      { cmd: 'git reflog', note: 'Find the line just before “reset: moving to …” and copy its id.' },
      { cmd: 'git branch rescue <commit-id>', note: 'Bookmark it so it can’t get lost again.' },
      { cmd: 'git reset --keep rescue', note: 'Move your branch back to it.' },
    ],
  },
  {
    id: 'undo-merge',
    group: 'Branches and syncing',
    title: 'Undo a merge I just did',
    goal: 'Undo the merge I just did',
    danger: 'careful',
    why: 'Moves your branch back. Fine if you haven’t pushed the merge.',
    summary: 'Git remembers where you were before the merge as ORIG_HEAD. Go back there.',
    before: {
      caption: 'A merge you didn’t want',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'experiment', parents: ['a'] },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'm', col: 2, msg: 'merge', parents: ['b', 'f'], tone: 'focus' },
      ],
      refs: [
        { name: 'main', at: 'm', here: true },
        { name: 'experiment', at: 'f' },
      ],
    },
    after: {
      caption: 'main is back where it was',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'f', col: 1, lane: 1, msg: 'experiment', parents: ['a'] },
        { id: 'b', col: 1, msg: 'home page', parents: ['a'] },
        { id: 'm', col: 2, msg: 'merge', parents: ['b', 'f'], tone: 'gone' },
      ],
      refs: [
        { name: 'main', at: 'b', here: true },
        { name: 'experiment', at: 'f' },
      ],
    },
    steps: [{ cmd: 'git reset --merge ORIG_HEAD', note: 'Go back to just before the merge.' }],
    notes: ['Already pushed the merge? Use git revert -m 1 <merge-commit-id> and push instead.'],
  },

  // ---- Secrets and big files ----
  {
    id: 'env-not-pushed',
    group: 'Secrets and big files',
    top: true,
    title: 'I committed my .env (not pushed yet)',
    goal: 'I committed my .env file but haven’t pushed. Take it out of the last commit, keep it on my disk, and add it to .gitignore',
    danger: 'careful',
    why: 'Rewrites your last commit. Fine because it isn’t on GitHub yet.',
    summary: 'Untrack .env (it stays on your disk), ignore it, and rewrite the last commit without it.',
    before: {
      caption: 'Your keys are in a commit',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'add login', parents: ['a'], tone: 'bad' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
    },
    after: {
      caption: 'Same commit, no .env',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'add login', parents: ['a'], tone: 'new' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
      work: { at: 'b', text: '.env ignored', tone: 'ok' },
    },
    steps: [
      { cmd: "printf '.env*\\n!.env.example\\n' >> .gitignore", note: 'Ignore every .env file, but keep .env.example.' },
      { cmd: 'git rm --cached .env', note: 'Stop tracking .env. The file stays on your computer.' },
      { cmd: 'git add .gitignore', note: 'Stage the .gitignore change.' },
      { cmd: 'git commit --amend --no-edit', note: 'Rewrite the last commit without .env.' },
    ],
    notes: [
      'Committed it more than one commit ago? Use the agent prompt: it’s a history rewrite, and your agent can do it with you watching.',
      'Pushed it after all? Then follow “I pushed my .env to GitHub”.',
    ],
    links: [IGNORE],
  },
  {
    id: 'env-pushed',
    group: 'Secrets and big files',
    top: true,
    title: 'I pushed my .env to GitHub',
    goal: 'I pushed my .env file to GitHub. Help me rotate the keys and stop tracking it',
    danger: 'careful',
    why: 'The commands are safe, but your keys are already exposed. Rotate them first.',
    summary: 'Rotate every key first: bots find keys on GitHub in minutes. Then stop tracking the file.',
    before: {
      caption: 'Your keys are on GitHub',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'add login', parents: ['a'], tone: 'bad' },
      ],
      refs: [
        { name: 'main', at: 'b', here: true },
        { name: 'origin/main', at: 'b', remote: true },
      ],
    },
    after: {
      caption: 'Keys rotated, .env untracked',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'add login', parents: ['a'], tone: 'bad' },
        { id: 'c', col: 2, msg: 'untrack .env', parents: ['b'], tone: 'new' },
      ],
      refs: [
        { name: 'main', at: 'c', here: true },
        { name: 'origin/main', at: 'c', remote: true },
      ],
      work: { at: 'c', text: '.env ignored', tone: 'ok' },
    },
    steps: [
      { note: 'First, rotate every key in that .env: make a new key in each service’s dashboard and delete the old one. Do this before anything else.' },
      { cmd: "printf '.env*\\n!.env.example\\n' >> .gitignore", note: 'Ignore every .env file, but keep .env.example.' },
      { cmd: 'git rm --cached .env', note: 'Stop tracking .env. The file stays on your computer.' },
      { cmd: 'git add .gitignore', note: 'Stage the .gitignore change.' },
      { cmd: 'git commit -m "Stop tracking .env"', note: 'Commit it.' },
      { cmd: 'git push', note: 'Send it to GitHub.' },
    ],
    notes: [
      'The old commit (red) still has the old keys. Once they’re rotated, they’re useless, so it’s fine to leave it.',
      'Removing it from history too needs git filter-repo and a force push. Everyone has to clone again, so only do it if you must.',
    ],
    links: [LEAK, IGNORE],
  },
  {
    id: 'untrack-folder',
    group: 'Secrets and big files',
    title: 'I committed node_modules (or another folder)',
    goal: 'I committed node_modules by mistake. Stop tracking it, keep it on disk, and add it to .gitignore',
    danger: 'safe',
    why: 'The folder stays on your disk. Git just stops tracking it.',
    summary: 'Ignore the folder, then untrack it. Your copy on disk doesn’t change.',
    before: {
      caption: 'Thousands of files in git',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'add deps', parents: ['a'], tone: 'bad' },
      ],
      refs: [{ name: 'main', at: 'b', here: true }],
    },
    after: {
      caption: 'Ignored from now on',
      commits: [
        { id: 'a', col: 0, msg: 'setup' },
        { id: 'b', col: 1, msg: 'add deps', parents: ['a'], tone: 'bad' },
        { id: 'c', col: 2, msg: 'untrack it', parents: ['b'], tone: 'new' },
      ],
      refs: [{ name: 'main', at: 'c', here: true }],
      work: { at: 'c', text: 'node_modules ignored', tone: 'ok' },
    },
    steps: [
      { cmd: "echo 'node_modules/' >> .gitignore", note: 'Ignore the folder from now on.' },
      { cmd: 'git rm -r --cached node_modules', note: 'Stop tracking it. The folder stays on your disk.' },
      { cmd: 'git add .gitignore', note: 'Stage the .gitignore change.' },
      { cmd: 'git commit -m "Stop tracking node_modules"', note: 'Commit it.' },
    ],
    notes: ['Same for dist, .next, build or any other folder: swap the name.'],
    links: [IGNORE],
  },
];

// Text you can paste into a terminal: each command with its note as a comment above it.
export function commandsText(s: Situation): string {
  return s.steps
    .map((st) => (st.cmd ? `# ${st.note}\n${st.cmd}` : `# ${st.note}`))
    .join('\n\n');
}

// A prompt for Claude Code, Cursor or Codex that asks for the same fix, carefully.
export function agentPrompt(s: Situation): string {
  const lines = [
    `Help me with git in this project. ${s.goal}.`,
    '',
    'Please do it safely:',
    '1. First run `git status` and `git log --oneline --graph -10` and tell me in plain words what you see.',
    s.danger === 'safe'
      ? '2. If anything you do could lose work, make a backup branch first.'
      : '2. Before changing anything, make a backup branch (for example `git branch backup-before-undo`) so nothing can be lost.',
    '3. These are the steps I think are right. Check them against what you see, and fill in the real branch names, file paths and commit ids:',
    '',
    '```sh',
    commandsText(s),
    '```',
    '',
    '4. Never run `git push --force`, `git reset --hard` on pushed commits, or delete branches or files without asking me first.',
    '5. When you’re done, show me `git log --oneline -5` and `git status` so I can see it worked.',
  ];
  return lines.join('\n');
}

export function findSituation(id: string): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}

// Search over titles, summaries and commands, so "reset", ".env" or "conflict" all find something.
export function matches(s: Situation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [s.title, s.summary, s.goal, ...s.steps.map((x) => `${x.cmd ?? ''} ${x.note}`)].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
