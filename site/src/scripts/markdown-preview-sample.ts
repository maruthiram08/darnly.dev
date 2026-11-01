// The README that fills the editor on first visit. It shows off every feature in a few screens.
export const SAMPLE = `# Snapcart

A tiny shopping list app that syncs between phones. Built with **Next.js**, **Supabase** and a lot of help from an AI agent.

![Snapcart on a phone](https://darnly.dev/og/tools/markdown-preview.jpg)

> [!TIP]
> Edit anything on the left. The preview on the right updates as you type.

## Features

- Add items by typing or by voice
- Share a list with a link, no sign-up needed
- Works offline and syncs when you're back online
- ~~Dark mode~~ Dark mode is *coming soon*

## Getting started

\`\`\`bash
git clone https://github.com/you/snapcart.git
cd snapcart
npm install
npm run dev
\`\`\`

Then open [localhost:3000](http://localhost:3000) in your browser.

## Environment variables

| Name | What it's for | Safe in the browser? |
| --- | --- | :---: |
| \`NEXT_PUBLIC_SUPABASE_URL\` | Your Supabase project address | Yes |
| \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` | Public key, protected by Row Level Security | Yes |
| \`SUPABASE_SERVICE_ROLE_KEY\` | Admin key for server code | **No** |

> [!WARNING]
> Never put the service role key in a \`NEXT_PUBLIC_\` variable. Anyone could read it.

## Example

\`\`\`ts
export async function addItem(listId: string, name: string) {
  const { data, error } = await supabase
    .from('items')
    .insert({ list_id: listId, name, done: false });
  if (error) throw error;
  return data; // the new item
}
\`\`\`

## Roadmap

- [x] Shared lists
- [x] Offline mode
- [ ] Dark mode
- [ ] Recipes that fill your list

## License

MIT. Made with [Darnly](https://darnly.dev), which turns bugs you see on screen into fixes your AI agent understands.
`;
