// What the reader finds in /samples/image-to-text-error.png (1760×750), saved here so the sample
// shows a real result without downloading the reader. Regenerate if the sample picture changes.
export type Line = { text: string; conf: number; para: number; x0: number; y0: number; x1: number; y1: number };

export const EXAMPLE: { width: number; height: number; lines: Line[] } = {
  width: 1760,
  height: 750,
  lines: [
    { text: "Unhandled Runtime Error", conf: 96, para: 0, x0: 67, y0: 61, x1: 508, y1: 85 },
    { text: "TypeError: Cannot read properties of undefined (reading 'map')", conf: 87, para: 0, x0: 64, y0: 118, x1: 1565, y1: 159 },
    { text: "Source", conf: 96, para: 0, x0: 66, y0: 199, x1: 159, y1: 220 },
    { text: "src/components/TodoList.tsx (14:22) @ TodoList", conf: 74, para: 0, x0: 67, y0: 247, x1: 837, y1: 274 },
    { text: "12 | const { data } = useTodos(userId);", conf: 87, para: 0, x0: 133, y0: 337, x1: 814, y1: 365 },
    { text: "13 | return (", conf: 88, para: 0, x0: 133, y0: 381, x1: 378, y1: 409 },
    { text: "> 14 | <ul>{data.todos.map((t) => (", conf: 84, para: 0, x0: 97, y0: 426, x1: 748, y1: 455 },
    { text: "~", conf: 67, para: 0, x0: 553, y0: 471, x1: 567, y1: 479 },
    { text: "15 | <TodoItem key={t.id} todo={t} />", conf: 92, para: 0, x0: 133, y0: 517, x1: 853, y1: 545 },
    { text: "16 | )) </ul>", conf: 64, para: 0, x0: 133, y0: 560, x1: 415, y1: 589 },
    { text: "Call Stack: renderWithHooks, mountindeterminateComponent", conf: 90, para: 0, x0: 66, y0: 663, x1: 932, y1: 690 },
  ],
};
