# Darnly for Mac

A menu bar app for bugs that aren't in a browser: Mac apps, the iOS Simulator and the Android Emulator.

Click the Darnly icon in the menu bar for its panel: a Capture button, where bugs go (this Mac or the cloud inbox), and your recent bugs, each marked Waiting until your agent moves it to `.darnly/done`, then Fixed. Right-click the icon for the full menu.

Press **Option+Shift+D**, click the broken part, type what you expected, press Enter. The report lands in your project's `.darnly/inbox/`, the same folder and format the Chrome extension uses, so your coding agent already knows what to do with it.

Agent in the cloud (Claude, Codex or Cursor online)? Choose **In the cloud** on the welcome screen (or **Cloud inbox** in the panel) and sign in with Google once. Captures then go to your private Darnly cloud inbox, the same one the Chrome extension uses, and the agent reads them through the Darnly connector at `https://api.darnly.dev/mcp`. If an upload fails, the bug is saved to the project folder (or `~/Darnly/.darnly/inbox`) instead. The session token is kept in the macOS Keychain.

Each report has:
- a screenshot of that window, with a red box around the element and a ring where you clicked;
- the element from macOS accessibility: its kind, title or label, value and accessibility id (`accessibilityIdentifier` / React Native `testID`), the best clue for finding the code;
- errors from the last 60 seconds: the iOS Simulator's apps (`simctl log`), the Android Emulator (`adb logcat`) or the Mac app itself (unified log), with secrets hidden;
- the device or app it was seen on;
- optionally, a picture of what it should look like: paste or drop one into the note box (handy for colors and layout).

## Run it

You need a Mac with macOS 14 or later and Xcode (or the Command Line Tools).

```sh
cd mac
swift run Darnly           # quickest way to try it
./scripts/make-app.sh && open build/Darnly.app   # the real app
```

Use `Darnly.app` for daily use: macOS then lists the permissions under **Darnly**. With `swift run` they go to Terminal instead. The app is signed ad hoc, so after a rebuild macOS may ask for the permissions again (proper signing comes with the Apple Developer account).

You can also open `mac/Package.swift` in Xcode and press Run.

On first launch a welcome screen walks you through choosing the project folder, the two permissions and the hotkey (reopen it from the menu: How to use Darnly). macOS needs two permissions (System Settings → Privacy & Security):
- **Accessibility**, to know which button or text you clicked;
- **Screen Recording**, for the screenshot.

When running with `swift run` or from Xcode, macOS asks on behalf of Terminal or Xcode. Use `Darnly.app` to see it as Darnly.

## Updates

A few seconds after launch, and once a day after that, Darnly asks GitHub for the newest `mac-v*` release (drafts and pre-releases are skipped). If it's newer than the running version, the menu gets **Update available: Darnly x.y.z…** at the top and a short note appears once. Clicking it opens the DMG download, or, if Darnly was installed with Homebrew, copies `brew upgrade --cask darnly`. **Check for updates…** in the menu asks right away. Builds run with `swift run` don't check. So users see an update, publish the release (below) and bump the cask.

## Share it (signed DMG)

`./scripts/make-dmg.sh` builds `build/Darnly.dmg`, signed with your Developer ID and notarized by Apple, so it opens on any Mac without a warning. One-time setup on your Mac:

1. **Developer ID certificate.** Xcode → Settings → Accounts → select your team → Manage Certificates → **+** → **Developer ID Application**. Only the team's Account Holder can create it. Check with `security find-identity -v -p codesigning`.
2. **App-specific password.** At [account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords → create one named "notarytool".
3. **Team ID.** On [developer.apple.com/account](https://developer.apple.com/account) → Membership details (10 characters).
4. **Save the notary login** in your keychain once:
   ```sh
   xcrun notarytool store-credentials darnly --apple-id you@example.com --team-id ABCDE12345 --password abcd-efgh-ijkl-mnop
   ```

Then `cd mac && ./scripts/make-dmg.sh` (`DARNLY_VERSION=0.3.2 ./scripts/make-dmg.sh` for a new version). It makes `build/Darnly.dmg` and prints the version and checksum for Homebrew.

To publish it: on GitHub, **Releases → Draft a new release**, tag `mac-v<version>` (for example `mac-v0.3.1`), title `Darnly for Mac <version>`, attach `build/Darnly.dmg`, and publish. darnly.dev's **Download for Mac** link (`releases/latest/download/Darnly.dmg`) then serves it. Whoever gets the DMG drags Darnly to Applications, opens it, and allows Accessibility and Screen Recording when asked.

Homebrew: `brew install --cask maruthiram08/darnly/darnly`. For each release, update version and sha256 in `Casks/darnly.rb` in [maruthiram08/homebrew-darnly](https://github.com/maruthiram08/homebrew-darnly) (and in `homebrew/darnly.rb` here) to what make-dmg.sh prints.

Why not the Mac App Store: App Store apps must run sandboxed, and a sandboxed app can't read other apps' accessibility elements or run `simctl`, `adb` or `log`, which is what Darnly needs. A notarized download plus Homebrew is how most Mac developer tools ship.

## Set up the coding agent

When you choose a project folder, Darnly offers (once) to tell your coding agent where the bugs are, the same files the Chrome extension writes: a short block in `AGENTS.md`, the `/darnly` skill (`.agents/skills` and `.claude/skills`), Cursor's `/darnly` command and two Claude Code hooks in `.claude/settings.json`. Your own text in those files is kept. Run it again any time from the menu: **Set up coding agent in this folder…** The texts come from `src/lib/agent-setup.ts` (generated into `Sources/DarnlyCore/AgentSetupText.swift`; after changing agent-setup.ts run `DARNLY_UPDATE_MAC=1 npx vitest run src/lib/mac-agent-setup.test.ts`).

## Cloud projects

In cloud mode the note box shows a **Project** name, so an agent asking the cloud for "this project's bugs" gets the Mac ones too. Darnly guesses it once per app (the project folder's name if you chose one, else the app's name) and remembers what you type.

## Keys while picking

Click to capture · ↑ / ↓ make the box bigger or smaller · W captures the whole window · Esc cancels.

Menu bar and notch apps work too: open the app's panel first, then press Option+Shift+D. The picker doesn't take focus, so the panel stays open while you pick.

## Tests

`swift test` runs the report, redaction, log-parsing, project-name and agent-setup tests. GitHub Actions runs them on every change under `mac/`, uploads an unsigned `Darnly-mac` zip, and draws the welcome screen and note box (`Darnly --snapshot <folder>`) to the `mac-ui-pictures` branch for review.
