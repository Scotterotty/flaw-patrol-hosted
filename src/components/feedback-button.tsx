"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { browserName, FEEDBACK_KINDS, MAX_SHOTS, type FeedbackKind } from "@/lib/feedback";
import { sendFeedback } from "@/server/feedback";
import { FeedbackMarkup, flatten, type Mark } from "./feedback-markup";
import { useMenuPlace } from "./menu-place";
import { Modal } from "./modal";
import { Button, cx, Textarea } from "./ui";

type Shot = { src: string; marks: Mark[]; fromPage: boolean; png: Blob; url: string };
type Stage = "closed" | "capturing" | "mark" | "send" | "sent";

/** Where you are, in words: the breadcrumbs in the top bar, plus the page heading when it adds something. */
function whereNow() {
  const crumbs = (document.querySelector('header nav[aria-label="Breadcrumb"]') as HTMLElement | null)?.innerText ?? "";
  const parts = crumbs
    .split(/\n|›|\//)
    .map((s) => s.trim())
    .filter(Boolean);
  const h1 = document.querySelector("main h1")?.textContent?.trim();
  if (h1 && !parts.includes(h1)) parts.push(h1);
  return parts.join(" › ").slice(0, 500) || document.title;
}

/**
 * A picture of what's on screen now, made from the page itself (html-to-image), so there's
 * no "share your screen" box and nothing outside Flaw Patrol is in it.
 */
async function capturePage(): Promise<string> {
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  return toPng(document.body, {
    backgroundColor: bg,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    width: window.innerWidth,
    height: window.innerHeight,
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`, transformOrigin: "top left" },
    filter: (n) => !(n instanceof HTMLElement && (n.dataset.feedbackSkip !== undefined || n.tagName === "DIALOG")),
  });
}

const readFile = (f: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error("Couldn't open that picture."));
    r.readAsDataURL(f);
  });

/**
 * Feedback, in the top bar of every page (it never floats over the page). Its menu: take a
 * screenshot of this page, add your own picture, or just write a note; then See feedback.
 */
export function FeedbackButton({ unseen = 0, waiting = 0 }: { unseen?: number; waiting?: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const place = useMenuPlace(open, box, list);
  const [stage, setStage] = useState<Stage>("closed");
  const [where, setWhere] = useState({ place: "", path: "" });
  const [shots, setShots] = useState<Shot[]>([]);
  // The picture on the markup screen: a new one, or one already added (Edit markup).
  const [marking, setMarking] = useState<{ src: string; marks: Mark[]; fromPage: boolean; index: number | null } | null>(null);
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const begin = () => {
    if (stage === "closed" || stage === "sent") {
      setWhere({ place: whereNow(), path: location.pathname + location.search });
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
      setKind(null);
      setMessage("");
      setAnonymous(false);
      setError("");
    }
  };

  const screenshot = async (index: number | null = null) => {
    setOpen(false);
    setError("");
    setStage("capturing");
    // Let the menu and any box close before the picture is taken.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const src = await capturePage();
      setMarking({ src, marks: [], fromPage: true, index });
      setStage("mark");
    } catch {
      setError("Couldn't take a screenshot of this page. You can add your own picture instead.");
      setStage("send");
    }
  };

  const ownPicture = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Pick a picture: PNG, JPEG, WebP or GIF.");
    try {
      setMarking({ src: await readFile(f), marks: [], fromPage: false, index: null });
      setStage("mark");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The file box is made only when it's needed, so pages keep just their own file inputs.
  const pickPicture = () => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
    input.addEventListener("change", () => void ownPicture(input.files?.[0]));
    input.click();
  };

  const doneMarking = async (marks: Mark[]) => {
    if (!marking) return;
    setBusy(true);
    try {
      const png = await flatten(marking.src, marks);
      const shot: Shot = { src: marking.src, marks, fromPage: marking.fromPage, png, url: URL.createObjectURL(png) };
      setShots((list) => {
        if (marking.index === null) return [...list, shot].slice(0, MAX_SHOTS);
        URL.revokeObjectURL(list[marking.index].url);
        return list.map((s, n) => (n === marking.index ? shot : s));
      });
      setMarking(null);
      setStage("send");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!kind) return setError("Pick what kind of feedback it is.");
    if (!message.trim() && !shots.length) return setError("Write a note or add a picture.");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("data", JSON.stringify({ kind, message, place: where.place, path: where.path, browser: browserName(navigator.userAgent), anonymous }));
    shots.forEach((s, n) => form.append("shot", new File([s.png], `feedback-${n + 1}.png`, { type: "image/png" })));
    const res = await sendFeedback(form).catch(() => ({ ok: false as const, error: "Couldn't send it. Check your connection and try again." }));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setStage("sent");
  };

  // A box closing (Esc, ✕, or because the next step opened) only ends things if it's still the step showing.
  const closeFrom = (from: Stage) => () =>
    setStage((s) => {
      if (s !== from) return s;
      if (from === "mark") setMarking(null);
      return "closed";
    });
  const close = () => setStage("closed");

  const item = "block w-full rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100";
  return (
    <div ref={box} className="relative" data-feedback-skip>
      {/* No aria-haspopup: the name menu stays the one menu button in the bar. aria-expanded still tells screen readers it opens. */}
      <button
        type="button"
        aria-expanded={open}
        data-howto="top-feedback"
        title="Send feedback about Flaw Patrol"
        onClick={() => {
          begin();
          setOpen((o) => !o);
        }}
        className="relative flex h-8 items-center gap-1.5 rounded-md border border-accent-500/40 bg-accent-50 px-2.5 text-sm font-medium text-accent-700 hover:bg-accent-100"
      >
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="hidden sm:inline">Feedback</span>
        <span className="sr-only sm:hidden">Feedback</span>
        {unseen > 0 && (
          <span data-testid="feedback-dot" className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface">
            <span className="sr-only">{unseen === 1 ? "1 new reply to your feedback" : `${unseen} new replies to your feedback`}</span>
          </span>
        )}
      </button>
      {open && (
        <div ref={list} role="menu" style={place} className="absolute top-full right-0 z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-surface p-1 shadow-lg">
          <button role="menuitem" type="button" className={item} onClick={() => screenshot()}>
            Take a screenshot of this page
          </button>
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              pickPicture();
            }}
          >
            Add my own picture
          </button>
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              setStage("send");
            }}
            data-howto="feedback-note"
          >
            Just write a note
          </button>
          <div className="my-1 h-px bg-slate-200" />
          <Link role="menuitem" href="/feedback" className={item} onClick={() => setOpen(false)} data-howto="feedback-see">
            See feedback
            {unseen > 0 && <span className="ml-1.5 text-xs font-medium text-red-600">{unseen === 1 ? "1 new reply" : `${unseen} new replies`}</span>}
            {waiting > 0 && <span className="ml-1.5 text-xs text-slate-500">{waiting} new</span>}
          </Link>
        </div>
      )}
      {stage === "capturing" && <Busy />}
      {stage === "mark" && marking && (
        <BigBox onClose={closeFrom("mark")}>
          <FeedbackMarkup
            key={marking.src}
            src={marking.src}
            marks={marking.marks}
            busy={busy}
            onDone={doneMarking}
            onCancel={() => {
              setMarking(null);
              // Back to the note when there's one going, else nothing was started.
              setStage(shots.length || message ? "send" : "closed");
            }}
            onRetake={marking.fromPage ? () => screenshot(marking.index) : undefined}
          />
        </BigBox>
      )}
      <Modal open={stage === "send"} onClose={closeFrom("send")} title="Send feedback" wide locked={busy}>
        <div className="space-y-4" data-testid="feedback-send">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">What kind of feedback?</legend>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_KINDS.map((k) => (
                <label key={k.id} className={cx("inline-flex h-9 cursor-pointer items-center rounded-full border px-3.5 text-sm", kind === k.id ? "border-accent-600 bg-accent-50 font-semibold text-accent-700" : "border-slate-300 text-slate-800 hover:bg-slate-50")}>
                  <input type="radio" name="feedback-kind" className="sr-only" checked={kind === k.id} onChange={() => setKind(k.id)} />
                  {k.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="feedback-message" className="mb-1.5 block text-sm font-medium text-slate-800">
              Tell us more
            </label>
            <Textarea id="feedback-message" data-howto="feedback-message" rows={4} value={message} maxLength={10000} onChange={(e) => setMessage(e.target.value)} placeholder="What happened, or what would make this better?" />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {shots.map((s, n) => (
              <div key={s.url} className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={`Picture ${n + 1}`} className="h-20 w-32 rounded border border-slate-300 object-cover" />
                <div className="flex flex-col gap-1 text-sm">
                  <button type="button" className="text-left text-accent-700 underline" onClick={() => (setMarking({ src: s.src, marks: s.marks, fromPage: s.fromPage, index: n }), setStage("mark"))}>
                    Edit markup
                  </button>
                  <button
                    type="button"
                    className="text-left text-slate-600 underline"
                    onClick={() => {
                      URL.revokeObjectURL(s.url);
                      setShots((l) => l.filter((_, i) => i !== n));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {shots.length < MAX_SHOTS && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => screenshot()}>
                  {shots.length ? "Add another screenshot" : "Add a screenshot"}
                </Button>
                <Button size="sm" onClick={pickPicture}>
                  Add my own picture
                </Button>
              </div>
            )}
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-medium text-slate-800">Added for you</p>
            <p>Where: {where.place || "this page"}</p>
            <p>
              Flaw Patrol {process.env.APP_VERSION} · {typeof navigator === "undefined" ? "" : browserName(navigator.userAgent)}
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 size-4" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span>
              Send without my name
              {anonymous && <span className="block text-xs text-slate-500">Nobody can tell it was you, so you won&apos;t see it on the Feedback page or get replies.</span>}
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={send} disabled={busy} data-howto="feedback-send">
              {busy ? "Sending…" : "Send feedback"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={stage === "sent"} onClose={closeFrom("sent")} title="Thanks for the feedback">
        <p className="text-sm text-slate-700">{anonymous ? "It went to your workspace admins without your name." : "Your workspace admins can see it now. Replies show up on the Feedback page, with a dot on Feedback."}</p>
        <div className="mt-4 flex justify-end gap-2">
          {!anonymous && (
            <Link href="/feedback" onClick={close} className="inline-flex h-9 items-center rounded-md border border-slate-300 px-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
              See your feedback
            </Link>
          )}
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Busy() {
  return createPortal(
    <div role="status" data-feedback-skip className="fp-right fixed right-4 bottom-4 z-50 rounded-md bg-slate-900 px-3 py-2 text-sm text-white shadow-lg">
      Taking a screenshot…
    </div>,
    document.body,
  );
}

/** A box nearly as big as the window, for marking up a screenshot. */
function BigBox({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return createPortal(
    <dialog ref={ref} aria-label="Show us what you mean" onClose={onClose} className="m-auto w-[min(72rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-lg bg-surface p-0 shadow-xl backdrop:bg-black/60">
      {children}
    </dialog>,
    document.body,
  );
}
