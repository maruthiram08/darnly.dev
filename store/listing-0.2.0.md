# Store update for 0.2.0 (cloud inbox)

Upload only after 0.1.x is approved. Change these fields in the Developer Dashboard. Everything else stays as in `listing.md`.

**Description:** replace the line "Working on a cloud project? Copy the picture and the details and paste them into your agent's chat." with:

Working on a cloud project (Claude, Codex or Cursor online)? Sign in once, and each bug goes to your private Darnly inbox. Add Darnly as a connector in your agent and it picks the bugs up there, with nothing to paste.

And replace the "Private by default" list with:

Private by default
- No account needed. Without the cloud inbox, nothing leaves your computer unless you paste it.
- The cloud inbox is optional. Bugs there are private to you and the agents you connect, and fixed ones are deleted after 30 days.
- Passwords, card numbers, tokens and API keys are hidden on your computer before anything is saved or sent.
- Works on localhost straight away; you switch on other sites one at a time.

**Homepage URL:** https://darnly.dev

**Privacy policy URL:** https://github.com/maruthiram08/darnly.dev/blob/main/PRIVACY.md (now covers the cloud inbox)

**Single purpose:** unchanged.

**New permission justification:**
- identity: "Sign in with Google" for the optional cloud inbox, so bugs from a cloud project can be sent to the user's own private inbox. Used only when the user clicks the button.

**Data use disclosures (changes):**
- Keep Website content, User activity and Web history ticked.
- Also tick **Personally identifiable information** (the email address of the Google account used for the cloud inbox).
- Keep all three certifications ticked. The data goes only to Darnly's own server, to provide the feature the user asked for; it is not sold or used for anything else.

**Remote code:** still No. The extension talks to the Darnly API (data only), and no code is downloaded.
