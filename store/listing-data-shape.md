# Store update for "The data behind this element"

For the first release that includes the data shape (after 0.3.2). Change these fields in the Developer Dashboard. Everything else stays as it is.

**Description:** after the paragraph that lists what a report holds, add:

Bugs that only happen with your real data? Darnly also adds the shape of the record behind the element you clicked: its field names, which ones are empty, how long the text is and how old the record is. Never the real values. Your agent can then test with a record like yours instead of a fresh one.

And add this line to the "Private by default" list:
- The data behind an element is described by its shape only (field names, lengths, ages). Real values never leave your browser.

**Privacy policy URL:** unchanged (https://github.com/maruthiram08/darnly.dev/blob/main/PRIVACY.md). It now has a section "The data behind this element". Merge the PR before submitting so the policy is live when reviewers read it.

**Single purpose:** unchanged. The data shape is part of the bug report.

**Permissions:** no new permissions. It uses the same page recorder as console errors, so it runs only on localhost and on sites the user switched recording on for.

**Permission justification, optional host permissions (add one sentence):** On those sites the recorder also notes the shape (field names and lengths, never values) of the record behind the element the user captures, for the bug report.

**Data use disclosures:** no change. Keep Website content ticked: the data shape comes from the page's own content. Keep the three certifications ticked.

**Remote code:** still No.

**"What's new" text (if asked):** Reports now include the shape of the data behind the element you capture (field names, empty fields, lengths, ages, never values), so your agent can reproduce bugs that only happen with your real data.
