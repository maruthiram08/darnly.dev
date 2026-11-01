// Builds a .ico file that holds PNG images (supported by every current browser).
import { concat } from './zip';

export function makeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = new Uint8Array(6 + 16 * images.length);
  const v = new DataView(header.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true); // icon
  v.setUint16(4, images.length, true);
  let offset = header.length;
  images.forEach((img, i) => {
    const at = 6 + 16 * i;
    header[at] = img.size >= 256 ? 0 : img.size;
    header[at + 1] = img.size >= 256 ? 0 : img.size;
    v.setUint16(at + 4, 1, true); // planes
    v.setUint16(at + 6, 32, true); // bits per pixel
    v.setUint32(at + 8, img.png.length, true);
    v.setUint32(at + 12, offset, true);
    offset += img.png.length;
  });
  return concat([header, ...images.map((i) => i.png)]);
}
