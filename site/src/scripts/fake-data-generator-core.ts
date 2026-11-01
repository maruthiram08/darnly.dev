// Fake data generator: a small seeded generator with built-in word lists (no faker dependency).
// Everything runs in the browser. The same seed always gives the same rows.

export type Kind =
  | 'id' | 'uuid' | 'fullName' | 'firstName' | 'lastName' | 'username' | 'email' | 'phone' | 'avatar'
  | 'company' | 'jobTitle' | 'street' | 'city' | 'country' | 'zip'
  | 'productName' | 'category' | 'price' | 'quantity' | 'rating' | 'image' | 'color'
  | 'title' | 'slug' | 'sentence' | 'paragraph' | 'tag' | 'status' | 'url'
  | 'date' | 'datetime' | 'boolean' | 'integer' | 'number';

export interface Field { name: string; kind: Kind }
export type Value = string | number | boolean;
export type Row = Record<string, Value>;

export const KINDS: { kind: Kind; label: string; group: string }[] = [
  { kind: 'id', label: 'ID (1, 2, 3…)', group: 'Basics' },
  { kind: 'uuid', label: 'UUID', group: 'Basics' },
  { kind: 'boolean', label: 'True / false', group: 'Basics' },
  { kind: 'integer', label: 'Whole number', group: 'Basics' },
  { kind: 'number', label: 'Decimal number', group: 'Basics' },
  { kind: 'date', label: 'Date', group: 'Basics' },
  { kind: 'datetime', label: 'Date and time', group: 'Basics' },
  { kind: 'fullName', label: 'Full name', group: 'People' },
  { kind: 'firstName', label: 'First name', group: 'People' },
  { kind: 'lastName', label: 'Last name', group: 'People' },
  { kind: 'username', label: 'Username', group: 'People' },
  { kind: 'email', label: 'Email', group: 'People' },
  { kind: 'phone', label: 'Phone', group: 'People' },
  { kind: 'avatar', label: 'Avatar URL', group: 'People' },
  { kind: 'company', label: 'Company', group: 'People' },
  { kind: 'jobTitle', label: 'Job title', group: 'People' },
  { kind: 'street', label: 'Street address', group: 'Places' },
  { kind: 'city', label: 'City', group: 'Places' },
  { kind: 'country', label: 'Country', group: 'Places' },
  { kind: 'zip', label: 'Postal code', group: 'Places' },
  { kind: 'productName', label: 'Product name', group: 'Shop' },
  { kind: 'category', label: 'Category', group: 'Shop' },
  { kind: 'price', label: 'Price', group: 'Shop' },
  { kind: 'quantity', label: 'Quantity', group: 'Shop' },
  { kind: 'rating', label: 'Rating (1 to 5)', group: 'Shop' },
  { kind: 'image', label: 'Image URL', group: 'Shop' },
  { kind: 'color', label: 'Color (hex)', group: 'Shop' },
  { kind: 'status', label: 'Order status', group: 'Shop' },
  { kind: 'title', label: 'Post title', group: 'Text' },
  { kind: 'slug', label: 'Slug (from title)', group: 'Text' },
  { kind: 'sentence', label: 'Sentence', group: 'Text' },
  { kind: 'paragraph', label: 'Paragraph', group: 'Text' },
  { kind: 'tag', label: 'Tag', group: 'Text' },
  { kind: 'url', label: 'Website URL', group: 'Text' },
];

export const TEMPLATES: Record<string, { label: string; table: string; type: string; fields: Field[] }> = {
  users: {
    label: 'Users', table: 'users', type: 'User',
    fields: [
      { name: 'id', kind: 'uuid' },
      { name: 'full_name', kind: 'fullName' },
      { name: 'email', kind: 'email' },
      { name: 'avatar_url', kind: 'avatar' },
      { name: 'job_title', kind: 'jobTitle' },
      { name: 'city', kind: 'city' },
      { name: 'is_active', kind: 'boolean' },
      { name: 'created_at', kind: 'datetime' },
    ],
  },
  products: {
    label: 'Products', table: 'products', type: 'Product',
    fields: [
      { name: 'id', kind: 'id' },
      { name: 'name', kind: 'productName' },
      { name: 'category', kind: 'category' },
      { name: 'price', kind: 'price' },
      { name: 'rating', kind: 'rating' },
      { name: 'image_url', kind: 'image' },
      { name: 'in_stock', kind: 'boolean' },
      { name: 'description', kind: 'sentence' },
    ],
  },
  orders: {
    label: 'Orders', table: 'orders', type: 'Order',
    fields: [
      { name: 'id', kind: 'uuid' },
      { name: 'customer_name', kind: 'fullName' },
      { name: 'customer_email', kind: 'email' },
      { name: 'product', kind: 'productName' },
      { name: 'quantity', kind: 'quantity' },
      { name: 'total', kind: 'price' },
      { name: 'status', kind: 'status' },
      { name: 'ship_to_city', kind: 'city' },
      { name: 'ordered_at', kind: 'datetime' },
    ],
  },
  posts: {
    label: 'Blog posts', table: 'posts', type: 'Post',
    fields: [
      { name: 'id', kind: 'id' },
      { name: 'title', kind: 'title' },
      { name: 'slug', kind: 'slug' },
      { name: 'author', kind: 'fullName' },
      { name: 'cover_image', kind: 'image' },
      { name: 'excerpt', kind: 'paragraph' },
      { name: 'tag', kind: 'tag' },
      { name: 'published', kind: 'boolean' },
      { name: 'published_at', kind: 'date' },
    ],
  },
};

// Word lists ---------------------------------------------------------------

const FIRST = 'Ada Amara Aiko Alex Amir Ana Arjun Ava Ben Bianca Carlos Chen Chloe Dana Daniel Diego Elena Eli Emma Farah Felix Grace Hana Hugo Ines Isaac Ivy Jamal Jin Jonas Kai Kemi Lara Leo Lina Luca Maya Mateo Mei Mila Nadia Noah Nora Omar Priya Quinn Rafael Ravi Rosa Sam Sara Sofia Tariq Theo Uma Victor Wei Yara Yusuf Zara Zoe'.split(' ');
const LAST = 'Adams Ahmed Alvarez Bauer Becker Brooks Chen Costa Das Dubois Edwards Fischer Flores Garcia Gupta Haddad Hansen Ito Jensen Johnson Kaur Khan Kim Kowalski Larsen Lee Lopez Martin Meyer Mehta Moreau Nakamura Nguyen Novak Okafor Oliveira Park Patel Perez Petrov Reyes Rossi Santos Schmidt Silva Singh Smith Suzuki Tanaka Taylor Torres Walker Wang Weber Williams Wong Yilmaz Young Zhang'.split(' ');
const DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.test'];
const JOBS = ['Product Designer', 'Frontend Developer', 'Backend Engineer', 'Founder', 'Marketing Lead', 'Data Analyst', 'Support Specialist', 'Product Manager', 'Sales Manager', 'Content Writer', 'DevOps Engineer', 'UX Researcher', 'Account Executive', 'Operations Lead', 'Mobile Developer', 'Growth Marketer'];
const CO_A = ['Blue', 'Bright', 'North', 'Silver', 'Green', 'Swift', 'Clear', 'Bold', 'Little', 'Open', 'Pixel', 'Cloud', 'Golden', 'Quiet', 'Rapid', 'Lumen'];
const CO_B = ['Labs', 'Works', 'Studio', 'Systems', 'Co', 'Collective', 'Digital', 'Partners', 'Foods', 'Health', 'Analytics', 'Goods'];
const CITIES: [string, string][] = [
  ['New York', 'United States'], ['San Francisco', 'United States'], ['Austin', 'United States'], ['Chicago', 'United States'], ['Toronto', 'Canada'], ['Vancouver', 'Canada'],
  ['Mexico City', 'Mexico'], ['São Paulo', 'Brazil'], ['Buenos Aires', 'Argentina'], ['London', 'United Kingdom'], ['Manchester', 'United Kingdom'], ['Dublin', 'Ireland'],
  ['Paris', 'France'], ['Berlin', 'Germany'], ['Munich', 'Germany'], ['Amsterdam', 'Netherlands'], ['Madrid', 'Spain'], ['Lisbon', 'Portugal'], ['Rome', 'Italy'],
  ['Stockholm', 'Sweden'], ['Copenhagen', 'Denmark'], ['Warsaw', 'Poland'], ['Istanbul', 'Turkey'], ['Cairo', 'Egypt'], ['Lagos', 'Nigeria'], ['Nairobi', 'Kenya'],
  ['Cape Town', 'South Africa'], ['Dubai', 'United Arab Emirates'], ['Mumbai', 'India'], ['Bengaluru', 'India'], ['Hyderabad', 'India'], ['Singapore', 'Singapore'],
  ['Jakarta', 'Indonesia'], ['Bangkok', 'Thailand'], ['Seoul', 'South Korea'], ['Tokyo', 'Japan'], ['Osaka', 'Japan'], ['Shanghai', 'China'], ['Sydney', 'Australia'], ['Auckland', 'New Zealand'],
];
const STREETS = ['Maple', 'Oak', 'Cedar', 'Elm', 'Park', 'Lake', 'Hill', 'River', 'Sunset', 'Station', 'Church', 'Garden', 'Mill', 'Harbor', 'Willow', 'Market'];
const ST_TYPE = ['Street', 'Avenue', 'Road', 'Lane', 'Way', 'Drive', 'Court', 'Place'];
const ADJ = ['Classic', 'Everyday', 'Organic', 'Compact', 'Wireless', 'Minimal', 'Handmade', 'Ultra', 'Smart', 'Cozy', 'Vintage', 'Eco', 'Pro', 'Travel', 'Soft', 'Premium'];
const CATS: Record<string, string[]> = {
  Electronics: ['Headphones', 'Speaker', 'Keyboard', 'Webcam', 'Charger', 'Smartwatch', 'Mouse', 'Monitor'],
  Home: ['Lamp', 'Mug', 'Candle', 'Throw Blanket', 'Plant Pot', 'Wall Clock', 'Cushion', 'Vase'],
  Clothing: ['Hoodie', 'T-Shirt', 'Sneakers', 'Jacket', 'Beanie', 'Socks', 'Backpack', 'Cap'],
  Beauty: ['Face Serum', 'Lip Balm', 'Hand Cream', 'Shampoo', 'Sunscreen', 'Soap Bar'],
  Kitchen: ['Chef Knife', 'Water Bottle', 'Coffee Grinder', 'Cutting Board', 'Tea Kettle', 'Lunch Box'],
  Sports: ['Yoga Mat', 'Dumbbells', 'Jump Rope', 'Running Belt', 'Gym Bag', 'Foam Roller'],
};
const CAT_NAMES = Object.keys(CATS);
const STATUS = ['pending', 'paid', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled', 'refunded'];
const TAGS = ['design', 'react', 'startup', 'ai', 'productivity', 'tutorial', 'news', 'marketing', 'nextjs', 'supabase', 'career', 'tips'];
const T_VERB = ['Build', 'Launch', 'Design', 'Ship', 'Grow', 'Test', 'Price', 'Scale', 'Market', 'Fix'];
const T_NOUN = ['a SaaS app', 'your first product', 'a landing page', 'a mobile app', 'an online store', 'a newsletter', 'a side project', 'a design system', 'an API', 'a waitlist'];
const T_PATTERNS = [
  (v: string, n: string, k: number) => `How to ${v.toLowerCase()} ${n} in a weekend`,
  (v: string, n: string, k: number) => `${k} ways to ${v.toLowerCase()} ${n}`,
  (v: string, n: string) => `Why we stopped trying to ${v.toLowerCase()} ${n} alone`,
  (v: string, n: string) => `The beginner's guide to ${n}`,
  (v: string, n: string, k: number) => `${k} mistakes I made with ${n}`,
  (v: string, n: string) => `What I learned when I tried to ${v.toLowerCase()} ${n}`,
];
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
const SITE_WORDS = ['acme', 'nimbus', 'orbit', 'sprout', 'kite', 'atlas', 'ember', 'fable', 'harbor', 'lumen', 'mosaic', 'pebble', 'quill', 'tidal', 'vista', 'zephyr'];

// Random numbers -----------------------------------------------------------

/** mulberry32: tiny seeded random number generator. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;
  const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)];
  return { next, int, pick };
}

type Rand = ReturnType<typeof rng>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function sentence(r: Rand, min = 6, max = 12) {
  const n = r.int(min, max);
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(r.pick(WORDS));
  return cap(words.join(' ')) + '.';
}

function uuid(r: Rand) {
  const h = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[r.int(0, 15)]).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[r.int(0, 3)]}${h(3)}-${h(12)}`;
}

/** Facts about one row that several fields share, so the email matches the name and the city matches the country. */
interface Person { first: string; last: string; city: [string, string]; category: string; title: string }

function person(r: Rand): Person {
  const category = r.pick(CAT_NAMES);
  return {
    first: r.pick(FIRST),
    last: r.pick(LAST),
    city: r.pick(CITIES),
    category,
    title: r.pick(T_PATTERNS)(r.pick(T_VERB), r.pick(T_NOUN), r.int(3, 12)),
  };
}

function value(kind: Kind, r: Rand, p: Person, index: number, now: number, product: { name?: string }): Value {
  switch (kind) {
    case 'id': return index + 1;
    case 'uuid': return uuid(r);
    case 'fullName': return `${p.first} ${p.last}`;
    case 'firstName': return p.first;
    case 'lastName': return p.last;
    case 'username': return `${slugify(p.first)}${r.pick(['', '_', '.'])}${slugify(p.last).slice(0, r.int(1, 6))}${r.int(1, 99)}`;
    case 'email': return `${slugify(p.first)}.${slugify(p.last)}@${r.pick(DOMAINS)}`;
    case 'phone': return `+1 555-01${pad(r.int(0, 99))}`;
    case 'avatar': return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(`${p.first} ${p.last}`)}`;
    case 'company': return `${r.pick(CO_A)} ${r.pick(CO_B)}`;
    case 'jobTitle': return r.pick(JOBS);
    case 'street': return `${r.int(1, 999)} ${r.pick(STREETS)} ${r.pick(ST_TYPE)}`;
    case 'city': return p.city[0];
    case 'country': return p.city[1];
    case 'zip': return pad(r.int(1000, 99999), 5);
    case 'productName': return (product.name ??= `${r.pick(ADJ)} ${r.pick(CATS[p.category])}`);
    case 'category': return p.category;
    case 'price': return Math.round((r.int(3, 299) + r.pick([0.99, 0.49, 0, 0.5, 0.95])) * 100) / 100;
    case 'quantity': return r.pick([1, 1, 1, 2, 2, 3, 4, 5]);
    case 'rating': return Math.round((3 + r.next() * 2) * 10) / 10;
    case 'image': return `https://picsum.photos/seed/${slugify(p.category)}-${index + 1}/640/480`;
    case 'color': return '#' + Array.from({ length: 3 }, () => r.int(0, 255).toString(16).padStart(2, '0')).join('');
    case 'status': return r.pick(STATUS);
    case 'title': return p.title;
    case 'slug': return slugify(p.title);
    case 'sentence': return sentence(r);
    case 'paragraph': return [sentence(r), sentence(r), sentence(r, 8, 16)].join(' ');
    case 'tag': return r.pick(TAGS);
    case 'url': return `https://${r.pick(SITE_WORDS)}${r.pick(['', 'app', 'hq', 'labs'])}.example.com`;
    case 'date': return new Date(now - r.int(0, 365) * 86400000).toISOString().slice(0, 10);
    case 'datetime': {
      const d = new Date(now - r.int(0, 365 * 24 * 60) * 60000);
      d.setUTCSeconds(0, 0);
      return d.toISOString().replace('.000Z', 'Z');
    }
    case 'boolean': return r.next() < 0.7;
    case 'integer': return r.int(0, 1000);
    case 'number': return Math.round(r.next() * 100000) / 100;
  }
}

export function generate(fields: Field[], count: number, seed: number, now = Date.now()): Row[] {
  const r = rng(seed);
  const rows: Row[] = [];
  const today = Math.floor(now / 60000) * 60000;
  // Emails and usernames must not repeat, because apps usually make them unique.
  const seen = new Map<string, Set<string>>();
  for (let i = 0; i < count; i++) {
    const p = person(r);
    const product: { name?: string } = {};
    const row: Row = {};
    for (const f of fields) {
      let v = value(f.kind, r, p, i, today, product);
      if (f.kind === 'email' || f.kind === 'username') {
        const set = seen.get(f.name) ?? new Set<string>();
        seen.set(f.name, set);
        if (set.has(String(v))) v = f.kind === 'email' ? String(v).replace('@', `${i + 1}@`) : `${v}${i + 1}`;
        set.add(String(v));
      }
      row[f.name] = v;
    }
    rows.push(row);
  }
  return rows;
}

// Field names ----------------------------------------------------------------

/** Turns whatever someone typed into a safe column name: letters, digits and underscores. */
export function cleanName(raw: string, fallback: string) {
  const s = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return fallback;
  return /^[0-9]/.test(s) ? `_${s}` : s;
}

/** Makes every field name unique, adding _2, _3 to repeats. */
export function uniqueFields(fields: Field[]): Field[] {
  const seen = new Map<string, number>();
  return fields.map((f, i) => {
    const base = cleanName(f.name, `field_${i + 1}`);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...f, name: n > 1 ? `${base}_${n}` : base };
  });
}

// Exports --------------------------------------------------------------------

export function toJSON(rows: Row[]) {
  return JSON.stringify(rows, null, 2) + '\n';
}

function csvCell(v: Value) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(fields: Field[], rows: Row[]) {
  const lines = [fields.map((f) => csvCell(f.name)).join(',')];
  for (const row of rows) lines.push(fields.map((f) => csvCell(row[f.name])).join(','));
  return lines.join('\r\n') + '\r\n';
}

const RESERVED = new Set('all and any as asc between by case check column constraint create cross default desc distinct do else end false for foreign from full grant group having in index inner into is join key left like limit not null offset on or order outer primary references right select table then to true union unique user using when where window with'.split(' '));

function ident(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function sqlType(kind: Kind): string {
  switch (kind) {
    case 'id': return 'integer';
    case 'uuid': return 'uuid';
    case 'price': return 'numeric(10, 2)';
    case 'rating': return 'numeric(2, 1)';
    case 'number': return 'numeric(10, 2)';
    case 'quantity': case 'integer': return 'integer';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'datetime': return 'timestamptz';
    default: return 'text';
  }
}

function sqlValue(v: Value) {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${v.replace(/'/g, "''")}'`;
}

export function toSQL(fields: Field[], rows: Row[], table: string, createTable = true) {
  const t = ident(table);
  const out: string[] = [];
  if (createTable) {
    const pk = fields.findIndex((f) => f.kind === 'id' || f.kind === 'uuid');
    const cols = fields.map((f, i) => `  ${ident(f.name)} ${sqlType(f.kind)}${i === pk ? ' primary key' : ' not null'}`);
    out.push(`create table if not exists ${t} (\n${cols.join(',\n')}\n);\n`);
  }
  const names = fields.map((f) => ident(f.name)).join(', ');
  // One insert per 500 rows keeps each statement small enough for the Supabase SQL editor.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map((row) => `  (${fields.map((f) => sqlValue(row[f.name])).join(', ')})`);
    out.push(`insert into ${t} (${names}) values\n${values.join(',\n')};\n`);
  }
  return out.join('\n');
}

function tsType(kind: Kind) {
  switch (kind) {
    case 'id': case 'price': case 'quantity': case 'rating': case 'integer': case 'number': return 'number';
    case 'boolean': return 'boolean';
    default: return 'string';
  }
}

function tsKey(name: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

export function toTS(fields: Field[], rows: Row[], typeName: string, varName: string) {
  const lines = [`export interface ${typeName} {`];
  for (const f of fields) lines.push(`  ${tsKey(f.name)}: ${tsType(f.kind)};`);
  lines.push('}', '', `export const ${varName}: ${typeName}[] = [`);
  for (const row of rows) {
    lines.push(`  { ${fields.map((f) => `${tsKey(f.name)}: ${JSON.stringify(row[f.name])}`).join(', ')} },`);
  }
  lines.push('];', '');
  return lines.join('\n');
}

/** "my orders" -> table my_orders, type MyOrder, variable myOrders. */
export function names(raw: string) {
  const table = cleanName(raw.toLowerCase(), 'items');
  const parts = table.split('_').filter(Boolean);
  const camel = parts.map((p, i) => (i ? cap(p) : p)).join('') || 'items';
  const singular = (s: string) => (/ies$/.test(s) ? s.slice(0, -3) + 'y' : /ses$/.test(s) ? s.slice(0, -2) : /s$/.test(s) && !/ss$/.test(s) ? s.slice(0, -1) : s);
  let type = parts.map((p, i) => cap(i === parts.length - 1 ? singular(p) : p)).join('') || 'Item';
  if (/^[0-9]/.test(type)) type = `T${type}`;
  const varName = /^[0-9]/.test(camel) ? `_${camel}` : camel;
  return { table, type, varName };
}
