// The sizes the social image resizer makes. Shared by the page (to draw the cards) and the script.

// Parts of an image that the site covers with something else. x, cx and w are fractions of the
// image's width; y, cy and h of its height; r of its width. They are close guides, not exact.
export type Cover =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; label?: string };

export type Slot = {
  key: string;
  name: string;
  net: 'x' | 'li' | 'ig' | 'yt' | 'any';
  badge: string;
  w: number;
  h: number;
  ratio: string;
  note: string;
  wide?: boolean;
  round?: boolean;
  cover?: { tip: string; shapes: Cover[] };
};

export const SLOTS: Slot[] = [
  {
    key: 'x-header', name: 'X header', net: 'x', badge: 'X', w: 1500, h: 500, ratio: '3:1', wide: true,
    note: 'Your profile photo sits over the bottom left. Max 2 MB.',
    cover: { tip: 'Profile photo covers this corner', shapes: [{ kind: 'circle', cx: 0.138, cy: 1, r: 0.112 }] },
  },
  {
    key: 'linkedin-banner', name: 'LinkedIn banner', net: 'li', badge: 'in', w: 1584, h: 396, ratio: '4:1', wide: true,
    note: 'Your profile photo covers part of the left side. Max 8 MB.',
    cover: { tip: 'Profile photo covers this part', shapes: [{ kind: 'circle', cx: 0.125, cy: 0.95, r: 0.095 }] },
  },
  {
    key: 'x-post', name: 'X post', net: 'x', badge: 'X', w: 1600, h: 900, ratio: '16:9',
    note: 'Shows in full in the feed at 16:9. Max 5 MB.',
  },
  {
    key: 'linkedin-post', name: 'LinkedIn post', net: 'li', badge: 'in', w: 1200, h: 627, ratio: '1.91:1',
    note: 'Same shape as a link preview picture.',
  },
  {
    key: 'youtube-thumbnail', name: 'YouTube thumbnail', net: 'yt', badge: '▶', w: 1280, h: 720, ratio: '16:9',
    note: 'The video length sits in the bottom right. Max 2 MB.',
    cover: { tip: 'Video length shows here', shapes: [{ kind: 'rect', x: 0.875, y: 0.87, w: 0.1, h: 0.09, label: '12:34' }] },
  },
  {
    key: 'instagram-square', name: 'Instagram square', net: 'ig', badge: 'IG', w: 1080, h: 1080, ratio: '1:1',
    note: 'The classic square post.',
  },
  {
    key: 'instagram-portrait', name: 'Instagram portrait', net: 'ig', badge: 'IG', w: 1080, h: 1350, ratio: '4:5',
    note: 'Tall post: takes up more of the screen in the feed.',
  },
  {
    key: 'profile-picture', name: 'Profile picture', net: 'any', badge: '◯', w: 400, h: 400, ratio: '1:1, shown round', round: true,
    note: 'Square file; X, LinkedIn, Instagram and YouTube cut it into a circle.',
  },
];
