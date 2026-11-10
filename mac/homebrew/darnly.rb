# Homebrew cask for the Darnly Mac app. Live copy: github.com/maruthiram08/homebrew-darnly (Casks/darnly.rb).
#   brew install --cask maruthiram08/darnly/darnly
# For each release, set version and sha256 to what make-dmg.sh prints.
cask "darnly" do
  version "0.3.3"
  sha256 "51a5b5804accae8211f712e35fe89cf0ccda29ecbf8546dc873946525e65bd15"

  url "https://github.com/maruthiram08/darnly.dev/releases/download/mac-v#{version}/Darnly.dmg"
  name "Darnly"
  desc "Capture a bug on screen and hand it to your AI coding agent"
  homepage "https://darnly.dev/"

  depends_on macos: :sonoma

  app "Darnly.app"

  zap trash: [
    "~/Library/Preferences/dev.darnly.mac.plist",
  ]
end
