# Homebrew cask for the Darnly Mac app. Goes in a tap repo (Casks/darnly.rb), then:
#   brew install --cask <tap>/darnly
# For each release, set version and sha256 to what make-dmg.sh prints.
cask "darnly" do
  version "0.3.1"
  sha256 "ba5b1527b18b9bb13ca73bd67d864d1f44a22b21e36c35a602e0dc023d4efe89"

  url "https://github.com/maruthiram08/darnly.dev/releases/download/mac-v#{version}/Darnly.dmg",
      verified: "github.com/maruthiram08/darnly.dev/"
  name "Darnly"
  desc "Capture a bug on screen and hand it to your AI coding agent"
  homepage "https://darnly.dev/"

  depends_on macos: ">= :sonoma"

  app "Darnly.app"

  zap trash: [
    "~/Library/Preferences/dev.darnly.mac.plist",
  ]
end
