/** Builds a capture file id like `2026-11-05-1402-checkout-button`. */
export function captureId(when: Date, label: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}`;
  const time = `${p(when.getHours())}${p(when.getMinutes())}`;
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 5)
      .join('-') || 'capture';
  return `${date}-${time}-${slug}`;
}
