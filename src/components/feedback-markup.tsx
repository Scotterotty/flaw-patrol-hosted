"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, cx } from "./ui";

/** Draw, Box, Circle, Arrow, Text and Hide private info, on a screenshot or picture (ver_145). */
export type MarkTool = "draw" | "box" | "circle" | "arrow" | "text" | "hide";
export type Mark =
  | { tool: "draw"; color: string; pts: [number, number][] }
  | { tool: "box" | "circle" | "arrow" | "hide"; color: string; x1: number; y1: number; x2: number; y2: number }
  | { tool: "text"; color: string; x: number; y: number; text: string };

export const MARK_TOOLS: { id: MarkTool; label: string; tip: string }[] = [
  { id: "draw", label: "Draw", tip: "Draw freehand" },
  { id: "box", label: "Box", tip: "Drag to draw a box" },
  { id: "circle", label: "Circle", tip: "Drag to draw a circle" },
  { id: "arrow", label: "Arrow", tip: "Drag from where the arrow starts to what it points at" },
  { id: "text", label: "Text", tip: "Click where the words go, type, then press Enter" },
  { id: "hide", label: "Hide private info", tip: "Drag over names, emails or anything private to black it out" },
];
export const MARK_COLORS = [
  { id: "#dc2626", label: "Red" },
  { id: "#facc15", label: "Yellow" },
  { id: "#2563eb", label: "Blue" },
];

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("Couldn't open that picture."));
    img.src = src;
  });

/** Line width and text size grow with the picture, so marks read the same on any screen size. */
const sizes = (w: number) => ({ line: Math.max(3, Math.round(w / 350)), font: Math.max(16, Math.round(w / 55)) });

function paint(ctx: CanvasRenderingContext2D, img: HTMLImageElement, marks: Mark[]) {
  const { width: w, height: h } = ctx.canvas;
  const { line, font } = sizes(w);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const m of marks) {
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineWidth = line;
    if (m.tool === "draw") {
      ctx.beginPath();
      m.pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (m.tool === "box") {
      ctx.strokeRect(Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.abs(m.x2 - m.x1), Math.abs(m.y2 - m.y1));
    } else if (m.tool === "hide") {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.abs(m.x2 - m.x1), Math.abs(m.y2 - m.y1));
    } else if (m.tool === "circle") {
      ctx.beginPath();
      ctx.ellipse((m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2, Math.abs(m.x2 - m.x1) / 2 || 1, Math.abs(m.y2 - m.y1) / 2 || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.tool === "arrow") {
      const angle = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
      const head = line * 5;
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.moveTo(m.x2 - head * Math.cos(angle - Math.PI / 6), m.y2 - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(m.x2, m.y2);
      ctx.lineTo(m.x2 - head * Math.cos(angle + Math.PI / 6), m.y2 - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (m.tool === "text") {
      // Words sit on a solid label so they read on any background.
      ctx.font = `600 ${font}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const pad = Math.round(font / 3);
      const tw = ctx.measureText(m.text).width;
      ctx.fillRect(m.x, m.y, tw + pad * 2, font + pad * 2);
      ctx.fillStyle = m.color === "#facc15" ? "#0f172a" : "#ffffff";
      ctx.textBaseline = "top";
      ctx.fillText(m.text, m.x + pad, m.y + pad);
    }
  }
}

/** The finished picture: the screenshot with every mark drawn in, as a PNG. */
export async function flatten(src: string, marks: Mark[]): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  paint(canvas.getContext("2d")!, img, marks);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Couldn't save the picture.");
  return blob;
}

/**
 * The markup screen: tools across the top, the picture below. Marks are kept as shapes, so
 * Undo takes the last one off and Edit markup later starts where you left off.
 */
export function FeedbackMarkup({ src, marks: start, onDone, onCancel, onRetake, busy }: { src: string; marks: Mark[]; onDone: (marks: Mark[]) => void; onCancel: () => void; onRetake?: () => void; busy?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>(start);
  const [tool, setTool] = useState<MarkTool>("circle");
  const [color, setColor] = useState(MARK_COLORS[0].id);
  const drawing = useRef<Mark | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const [words, setWords] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadImage(src).then(setImg, (e: Error) => setError(e.message));
  }, [src]);

  const redraw = useCallback(
    (extra?: Mark | null) => {
      const c = canvas.current;
      if (!c || !img) return;
      if (c.width !== img.naturalWidth) {
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
      }
      paint(c.getContext("2d")!, img, extra ? [...marks, extra] : marks);
    },
    [img, marks],
  );
  useEffect(() => redraw(), [redraw]);

  /** From the mouse to the picture's own pixels (the canvas is shown smaller than it is). */
  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * e.currentTarget.width) / r.width, y: ((e.clientY - r.top) * e.currentTarget.height) / r.height, left: e.clientX - r.left, top: e.clientY - r.top };
  };

  const commitWords = () => {
    if (typing && words.trim()) setMarks((m) => [...m, { tool: "text", color, x: typing.x, y: typing.y, text: words.trim().slice(0, 200) }]);
    setTyping(null);
    setWords("");
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    const p = at(e);
    if (tool === "text") {
      // Keep the click from taking focus off the typing box it's about to open.
      e.preventDefault();
      if (typing) commitWords();
      setTyping({ x: p.x, y: p.y, left: p.left, top: p.top });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = tool === "draw" ? { tool, color, pts: [[p.x, p.y]] } : { tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d) return;
    const p = at(e);
    if (d.tool === "draw") d.pts.push([p.x, p.y]);
    else if (d.tool !== "text") Object.assign(d, { x2: p.x, y2: p.y });
    redraw(d);
  };
  const up = () => {
    const d = drawing.current;
    drawing.current = null;
    if (!d) return;
    // A click without a drag leaves nothing behind.
    const tiny = d.tool === "draw" ? d.pts.length < 2 : d.tool !== "text" && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 4;
    if (!tiny) setMarks((m) => [...m, d]);
    else redraw();
  };

  return (
    <div className="flex max-h-[calc(100vh-4rem)] flex-col" data-testid="feedback-markup">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">Show us what you mean</h2>
        <span className="text-xs text-slate-500">Step 1 of 2</span>
      </div>
      <div role="toolbar" aria-label="Markup tools" className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-5 py-2">
        {MARK_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.tip}
            aria-pressed={tool === t.id}
            onClick={() => {
              commitWords();
              setTool(t.id);
            }}
            className={cx("h-9 rounded-md border px-3 text-sm", tool === t.id ? "border-accent-600 bg-accent-50 font-semibold text-accent-700" : "border-slate-300 bg-surface text-slate-800 hover:bg-slate-100")}
          >
            {t.label}
          </button>
        ))}
        <span aria-hidden className="mx-1.5 h-6 w-px bg-slate-300" />
        {MARK_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.label}
            title={c.label}
            aria-pressed={color === c.id}
            onClick={() => setColor(c.id)}
            className={cx("size-7 rounded-full", color === c.id ? "ring-2 ring-slate-900 ring-offset-2" : "ring-1 ring-slate-300")}
            style={{ background: c.id }}
          />
        ))}
        <span aria-hidden className="mx-1.5 h-6 w-px bg-slate-300" />
        <Button size="md" onClick={() => setMarks((m) => m.slice(0, -1))} disabled={!marks.length}>
          Undo
        </Button>
        {onRetake && (
          <Button size="md" onClick={onRetake}>
            Retake
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <div className="relative mx-auto w-fit">
            <canvas
              ref={canvas}
              aria-label="Your screenshot. Pick a tool, then drag on the picture."
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className={cx("block max-h-[60vh] max-w-full touch-none bg-white shadow-md", tool === "text" ? "cursor-text" : "cursor-crosshair")}
            />
            {typing && (
              <input
                autoFocus
                aria-label="Words to add"
                value={words}
                maxLength={200}
                onChange={(e) => setWords(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitWords();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setTyping(null);
                    setWords("");
                  }
                }}
                onBlur={commitWords}
                placeholder="Type, then Enter"
                className="absolute h-8 w-56 rounded border-2 bg-surface px-2 text-sm text-slate-900 shadow"
                style={{ left: typing.left, top: typing.top, borderColor: color }}
              />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <p className="text-xs text-slate-500">Only the Flaw Patrol page is in the picture, never the rest of your screen.</p>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!img || busy}
            onClick={() => {
              // Words still being typed go in too.
              const extra: Mark[] = typing && words.trim() ? [{ tool: "text", color, x: typing.x, y: typing.y, text: words.trim().slice(0, 200) }] : [];
              onDone([...marks, ...extra]);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
