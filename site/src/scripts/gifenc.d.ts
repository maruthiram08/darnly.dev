// Types for the bits of gifenc (https://github.com/mattdesl/gifenc) this site uses.
declare module 'gifenc' {
  type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: string }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: Palette; delay?: number; repeat?: number; first?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  };
}
