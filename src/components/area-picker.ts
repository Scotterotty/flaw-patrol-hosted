/**
 * After Take screenshot grabs the picture, it opens full size so the tester can
 * drag a box around just the part they want, or attach the whole thing.
 *
 * It's its own <dialog> opened with showModal(), so it sits on top of the bug box
 * (another modal dialog) and Esc closes only the picker. Built with plain DOM
 * because takeScreenshot() is a plain async function used from several places.
 */

type Box = { x: number; y: number; w: number; h: number };

/** Drags smaller than this (in screen pixels) are a stray click, not a box. */
const MIN_BOX = 8;

const btn =
  "rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500";
const plain = `${btn} border-slate-300 bg-surface text-slate-800 hover:bg-slate-100`;
const primary = `${btn} border-accent-600 bg-accent-600 text-white hover:bg-accent-700`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Cut a box (in the source canvas's own pixels) out of a canvas, at full sharpness. */
export function cropCanvas(source: HTMLCanvasElement, box: Box): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(box.w));
  out.height = Math.max(1, Math.round(box.h));
  out.getContext("2d")!.drawImage(source, Math.round(box.x), Math.round(box.y), out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Show the screenshot and let the tester pick. Resolves to the picked area, the
 * whole picture, or null when they cancel.
 */
export function pickArea(shot: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const dialog = el(
      "dialog",
      "m-0 h-full max-h-none w-full max-w-none bg-slate-900/90 p-0 text-white backdrop:bg-black/60",
    ) as HTMLDialogElement;
    dialog.setAttribute("aria-label", "Pick the area to attach");
    dialog.setAttribute("data-testid", "area-picker");
    dialog.setAttribute("data-feedback-skip", "");

    const wrap = el("div", "flex h-full flex-col");
    const bar = el("div", "flex flex-wrap items-center justify-between gap-2 bg-surface px-4 py-2 text-slate-900 shadow");
    const hint = el("p", "text-sm font-semibold", "Drag a box around the part you want");
    const barBtns = el("div", "flex flex-wrap gap-2");
    const whole = el("button", plain, "Attach whole screen");
    const cancel = el("button", plain, "Cancel");
    for (const b of [whole, cancel]) b.type = "button";
    barBtns.append(whole, cancel);
    bar.append(hint, barBtns);

    const area = el("div", "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4");
    // The stage is exactly the size the picture is shown at, so box math stays simple.
    const stage = el("div", "relative cursor-crosshair touch-none select-none");
    shot.className = "block";
    shot.setAttribute("aria-hidden", "true");
    shot.draggable = false;
    const box = el("div", "absolute hidden cursor-move border-2 border-white");
    // A dark outline and a wide shadow dim everything outside the box, on any picture.
    box.style.boxShadow = "0 0 0 1px #000, 0 0 0 9999px rgba(0,0,0,.55)";
    box.setAttribute("data-testid", "area-box");
    const corners = (["nw", "ne", "sw", "se"] as const).map((c) => {
      const h = el("span", "absolute h-3 w-3 border border-black bg-white");
      h.dataset.corner = c;
      h.style.cursor = c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize";
      h.style[c.includes("n") ? "top" : "bottom"] = "-7px";
      h.style[c.includes("w") ? "left" : "right"] = "-7px";
      return h;
    });
    box.append(...corners);
    const near = el("div", "absolute z-10 hidden gap-2");
    const attach = el("button", primary, "Attach this area");
    const redo = el("button", plain, "Redo");
    for (const b of [attach, redo]) b.type = "button";
    near.append(attach, redo);
    stage.append(shot, box, near);
    area.append(stage);
    wrap.append(bar, area);
    dialog.append(wrap);

    // The box, in the picture's on-screen pixels.
    let sel: Box | null = null;
    const show = () => {
      if (!sel || sel.w < MIN_BOX || sel.h < MIN_BOX) {
        box.classList.add("hidden");
        near.classList.add("hidden");
        near.classList.remove("flex");
        return;
      }
      box.classList.remove("hidden");
      Object.assign(box.style, { left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
      near.classList.remove("hidden");
      near.classList.add("flex");
      // Buttons under the box, or inside its bottom edge when there's no room below.
      const room = stage.clientHeight - (sel.y + sel.h);
      near.style.left = `${Math.min(sel.x, Math.max(0, stage.clientWidth - 240))}px`;
      near.style.top = room > 48 ? `${sel.y + sel.h + 8}px` : `${Math.max(0, sel.y + sel.h - 44)}px`;
    };

    let done = false;
    const finish = (result: HTMLCanvasElement | null) => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    const attachArea = () => {
      if (!sel) return finish(shot);
      const scale = shot.width / stage.clientWidth;
      finish(cropCanvas(shot, { x: sel.x * scale, y: sel.y * scale, w: sel.w * scale, h: sel.h * scale }));
    };
    const clear = () => {
      sel = null;
      show();
      whole.focus();
    };

    // Drag outside the box: new box. Drag inside: move it. Drag a corner: resize.
    type Drag = { mode: "new" | "move" | "nw" | "ne" | "sw" | "se"; sx: number; sy: number; start: Box | null };
    let drag: Drag | null = null;
    const point = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
    };
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || near.contains(e.target as Node)) return;
      const p = point(e);
      const corner = (e.target as HTMLElement).dataset?.corner as Drag["mode"] | undefined;
      const mode: Drag["mode"] = corner ?? (sel && e.target === box ? "move" : "new");
      drag = { mode, sx: p.x, sy: p.y, start: sel ? { ...sel } : null };
      if (mode === "new") {
        sel = { x: p.x, y: p.y, w: 0, h: 0 };
        show();
      }
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = point(e);
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      const s = drag.start;
      if (drag.mode === "new") {
        sel = { x: Math.min(drag.sx, p.x), y: Math.min(drag.sy, p.y), w: Math.abs(p.x - drag.sx), h: Math.abs(p.y - drag.sy) };
      } else if (drag.mode === "move" && s) {
        const x = Math.min(Math.max(s.x + p.x - drag.sx, 0), W - s.w);
        const y = Math.min(Math.max(s.y + p.y - drag.sy, 0), H - s.h);
        sel = { ...s, x, y };
      } else if (s) {
        // Resize from a corner: the opposite corner stays put.
        const fx = drag.mode.includes("w") ? s.x + s.w : s.x;
        const fy = drag.mode.includes("n") ? s.y + s.h : s.y;
        sel = { x: Math.min(fx, p.x), y: Math.min(fy, p.y), w: Math.abs(p.x - fx), h: Math.abs(p.y - fy) };
      }
      show();
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      // A stray click isn't a box.
      if (sel && (sel.w < MIN_BOX || sel.h < MIN_BOX)) sel = null;
      show();
      if (sel) attach.focus();
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    // Dragging can't start a native image drag or text selection.
    stage.addEventListener("dragstart", (e) => e.preventDefault());

    whole.addEventListener("click", () => finish(shot));
    cancel.addEventListener("click", () => finish(null));
    attach.addEventListener("click", attachArea);
    redo.addEventListener("click", clear);
    // Esc cancels; Enter attaches the box, or the whole screen when there's no box.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || (e.target instanceof HTMLButtonElement && e.target !== whole && e.target !== attach)) return;
      e.preventDefault();
      if (sel) attachArea();
      else finish(shot);
    });
    // Window resized mid-pick: the picture changes size, so start the box over.
    // The picture is shown as big as fits, never bigger than it really is.
    const fit = () => {
      const r = area.getBoundingClientRect();
      const k = Math.min((r.width - 32) / shot.width, (r.height - 32) / shot.height, 1);
      shot.style.width = `${Math.max(1, Math.floor(shot.width * k))}px`;
      shot.style.height = `${Math.max(1, Math.floor(shot.height * k))}px`;
    };
    const onResize = () => {
      fit();
      if (sel) clear();
    };
    window.addEventListener("resize", onResize);
    dialog.addEventListener("close", () => window.removeEventListener("resize", onResize));

    document.body.append(dialog);
    dialog.showModal();
    fit();
    whole.focus();
  });
}
