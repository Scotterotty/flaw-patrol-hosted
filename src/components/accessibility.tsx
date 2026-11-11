"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ResultStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/lib/status";
import { FONTS, fontVars, TEXT_SIZES, type TextSize } from "@/lib/theme";
import { shapesOn, VISIONS, type Vision } from "@/lib/vision";
import { StatusChip, StatusIcon } from "./status";
import { updateMyAccessibility, updateMyBodyFont } from "@/server/account";
import { Sp } from "./spelling";
import { cx, ErrorText } from "./ui";

type Settings = { textSize: TextSize; reduceMotion: boolean; strongContrast: boolean; underlineLinks: boolean; colorVision: Vision; visionShapes: boolean };

const SWATCH_STATUS: ResultStatus[] = ["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED"];

const AIDS = [
  { key: "strongContrast", label: "Stronger contrast", help: "Darker secondary text and clearer borders." },
  { key: "underlineLinks", label: "Underline links", help: "So links don't rely on color alone. Links in sentences are always underlined; this underlines the rest too." },
  { key: "reduceMotion", label: "Reduce motion", help: "Turns off animations and transitions." },
] as const;

/** Text size and display aids. Applies instantly and saves to your account. */
export function AccessibilitySettings({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [a, setA] = useState(initial);
  const [shapesTouched, setShapesTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const save = (change: Partial<Settings>) => {
    const next = { ...a, ...change };
    setA(next);
    const root = document.documentElement.dataset;
    root.textSize = next.textSize;
    if (next.reduceMotion) root.motion = "reduce";
    else delete root.motion;
    if (next.strongContrast) root.contrast = "more";
    else delete root.contrast;
    if (next.underlineLinks) root.links = "underline";
    else delete root.links;
    if (next.colorVision !== "standard") root.vision = next.colorVision;
    else delete root.vision;
    if (shapesOn(next.colorVision, next.visionShapes)) root.shapes = "on";
    // High contrast look always shows shapes (ver_202).
    else if (root.look !== "hc") delete root.shapes;
    start(async () => {
      const res = await updateMyAccessibility(next);
      setError(res.ok ? null : res.error);
      // The folded card's one-line summary follows.
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <fieldset data-howto="access-text-size">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Text size</legend>
        <div className="flex flex-wrap gap-2">
          {TEXT_SIZES.map((t) => (
            <label
              key={t.id}
              className={cx(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-slate-700",
                a.textSize === t.id ? "border-accent-600 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <input type="radio" name="text-size" value={t.id} checked={a.textSize === t.id} onChange={() => save({ textSize: t.id })} className="sr-only" />
              <span aria-hidden="true" className="font-semibold" style={{ fontSize: `${(Number(t.id) / 100) * 0.875}rem` }}>
                A
              </span>
              <span className="text-xs">{t.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Makes all text and controls bigger or smaller, like zooming the page.</p>
      </fieldset>
      <fieldset data-testid="color-vision" data-howto="access-vision">
        <legend className="mb-0.5 text-sm font-semibold text-slate-900">
          <Sp>Color vision</Sp>
        </legend>
        <p className="mb-2 text-xs text-slate-500">
          <Sp>Changes the colors for Passed, Failed and the other statuses, only for you. Your theme stays the same.</Sp>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {VISIONS.map((v) => (
            <label
              key={v.id}
              className={cx("flex cursor-pointer gap-2.5 rounded-lg border p-2.5", a.colorVision === v.id ? "border-accent-600 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300")}
            >
              <input
                type="radio"
                name="color-vision"
                value={v.id}
                checked={a.colorVision === v.id}
                // Any choice but Standard turns shapes on, unless the person set the box themselves.
                onChange={() => save({ colorVision: v.id, visionShapes: v.id !== "standard" ? true : shapesTouched ? a.visionShapes : false })}
                className="mt-0.5 accent-accent-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">
                  <Sp>{v.label}</Sp>
                </span>
                <span className="block text-xs text-slate-500">
                  <Sp>{v.help}</Sp>
                </span>
                <span className="mt-1.5 flex gap-1" aria-hidden>
                  {v.swatch.map((c, i) => (
                    <span key={i} className="grid size-5 place-items-center rounded" style={{ background: c, color: i >= 3 && v.id !== "standard" && v.id !== "blueyellow" ? "#141414" : "#fff" }} title={STATUS_LABEL[SWATCH_STATUS[i]]}>
                      {(a.visionShapes || v.id !== "standard") && <StatusIcon status={SWATCH_STATUS[i]} always className="size-3" />}
                    </span>
                  ))}
                </span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={shapesOn(a.colorVision, a.visionShapes)}
            disabled={a.colorVision === "none"}
            onChange={(e) => {
              setShapesTouched(true);
              save({ visionShapes: e.target.checked });
            }}
            aria-describedby="a11y-shapes"
            className="size-4 accent-accent-600"
          />
          Shapes and patterns
        </label>
        <p id="a11y-shapes" className="mt-0.5 ml-6 text-xs text-slate-500">
          <Sp>{a.colorVision === "none" ? "Always on with No color, since shapes and patterns are how statuses differ." : "Adds a shape to every status and stripes or dots to bars, so color is never the only clue."}</Sp>
        </p>
        <div className="mt-2 ml-6 flex flex-wrap gap-1.5" aria-label="How statuses look now">
          {(["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED", "IN_PROGRESS", "UNTESTED"] as ResultStatus[]).map((st) => (
            <StatusChip key={st} status={st} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3" data-howto="access-aids">
        {AIDS.map((o) => (
          <div key={o.key}>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={a[o.key]}
                onChange={(e) => save({ [o.key]: e.target.checked })}
                aria-describedby={`a11y-${o.key}`}
                className="size-4 accent-accent-600"
              />
              {o.label}
            </label>
            <p id={`a11y-${o.key}`} className="mt-0.5 ml-6 text-xs text-slate-500">
              <Sp>{o.help}</Sp>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The three fonts made for easy reading. Appearance lists them too, with every other font. */
const EASY = (["atkinson", "lexend", "opendyslexic"] as const).map((id) => FONTS.find((f) => f.id === id)!);

/**
 * Accessibility's Easy-to-read font shortcut (ver_200): sets your text font to one that's easier
 * to read. It's the same setting as Appearance's Text font, which still lists every font.
 */
export function EasyReadFont({ body, heading }: { body: string; heading: string }) {
  const router = useRouter();
  const [mine, setMine] = useState(body);
  const [before] = useState(EASY.some((f) => f.id === body) ? "poppins" : body);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const pick = (id: string) => {
    setMine(id);
    document.documentElement.dataset.fontBody = id;
    // Your text font shows in every look (ver_221).
    for (const [k, v] of Object.entries(fontVars(id, heading))) document.documentElement.style.setProperty(k, v);
    start(async () => {
      const res = await updateMyBodyFont(id);
      setError(res.ok ? null : res.error);
      if (res.ok) router.refresh();
    });
  };
  const choices = [{ id: before, label: "My usual font", text: "Whatever Appearance has", family: "" }, ...EASY.map((f) => ({ id: f.id, label: f.label, text: "text" in f ? (f.text ?? "") : "", family: f.family }))];
  return (
    <fieldset data-testid="easy-font" data-howto="access-easy-font">
      <legend className="mb-0.5 text-sm font-semibold text-slate-900">Easy-to-read font</legend>
      <p className="mb-2 text-xs text-slate-500">Sets your text font. Appearance still lists every font.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((f) => (
          <label key={f.id} className={cx("flex cursor-pointer gap-2.5 rounded-lg border p-2.5", mine === f.id ? "border-accent-600 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300")}>
            <input type="radio" name="easy-font" value={f.id} checked={mine === f.id} onChange={() => pick(f.id)} className="mt-0.5 accent-accent-600" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900" style={f.family ? { fontFamily: f.family } : undefined}>
                {f.label}
              </span>
              <span className="block text-xs text-slate-500">{f.text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
