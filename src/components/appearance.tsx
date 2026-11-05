"use client";

import { useEffect, useState, useTransition } from "react";
import { ACCENTS, BODY_FONTS, THEMES, FONT_GROUPS, FONTS, fontVars, THEME_MODES, type Accent, type BodyFont, type HeadingFont, type ThemeMode } from "@/lib/theme";
import { updateMyAppearance } from "@/server/account";
import { Sp } from "./spelling";
import { cx, ErrorText, Select } from "./ui";

type Appearance = { themeMode: ThemeMode; accent: Accent; fontBody: BodyFont; fontHeading: HeadingFont };

// Small fixed previews of each mode; they don't follow the current theme.
const PREVIEW: Record<ThemeMode, { bg: string; card: string; line: string }> = {
  light: { bg: "#f8fafc", card: "#ffffff", line: "#cbd5e1" },
  dark: { bg: "#020618", card: "#0f172b", line: "#314158" },
  system: { bg: "linear-gradient(135deg, #f8fafc 50%, #020618 50%)", card: "transparent", line: "#94a3b8" },
};

const option = (selected: boolean) =>
  cx("cursor-pointer rounded-lg border text-xs", selected ? "border-accent-600 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300");

/** Light, dark or follow the computer; accent color; fonts. Applies instantly and saves to your account. */
export function AppearancePicker({ initial }: { initial: Appearance }) {
  const [a, setA] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const save = (change: Partial<Appearance>) => {
    const next = { ...a, ...change };
    setA(next);
    const root = document.documentElement.dataset;
    root.theme = next.themeMode;
    root.accent = next.accent;
    root.fontBody = next.fontBody;
    root.fontHeading = next.fontHeading;
    for (const [k, v] of Object.entries(fontVars(next.fontBody, next.fontHeading))) document.documentElement.style.setProperty(k, v);
    start(async () => {
      const res = await updateMyAppearance(next);
      setError(res.ok ? null : res.error);
    });
  };

  return (
    <div className="space-y-5">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <fieldset data-howto="appearance-mode">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Mode</legend>
        <div className="grid grid-cols-3 gap-2">
          {THEME_MODES.map((m) => {
            const p = PREVIEW[m.id];
            return (
              <label key={m.id} className={cx(option(a.themeMode === m.id), "p-2 text-center")}>
                <input type="radio" name="theme-mode" value={m.id} checked={a.themeMode === m.id} onChange={() => save({ themeMode: m.id })} className="sr-only" />
                <span aria-hidden="true" className="mb-1.5 block h-12 rounded-md border border-slate-200 p-1.5" style={{ background: p.bg }}>
                  <span className="block h-full rounded" style={{ background: p.card, boxShadow: `inset 0 0 0 1px ${p.line}` }} />
                </span>
                <span className="text-slate-700">{m.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset data-howto="appearance-color">
        <legend className="mb-2 text-sm font-semibold text-slate-900">
          <Sp>Color</Sp>
        </legend>
        <ColorPicker value={a.accent} mode={a.themeMode} onChange={(accent) => save({ accent })} />
        <p className="mt-1.5 text-xs text-slate-500">
          <Sp>Buttons, links and backgrounds follow this choice. Test statuses keep their own colors in every theme.</Sp>
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2" data-howto="appearance-fonts">
        <FontPicker
          id="font-body"
          label="Text font"
          help="Lists, forms, buttons and small print."
          value={a.fontBody}
          options={BODY_FONTS}
          onChange={(v) => save({ fontBody: v as BodyFont })}
          preview={(f) => (
            <span style={{ fontFamily: f?.family }}>
              The quick brown fox · Pass, Fail, Blocked · 0123
            </span>
          )}
        />
        <FontPicker
          id="font-heading"
          label="Heading font"
          help="Page and card titles."
          value={a.fontHeading}
          options={FONTS}
          sameAsText
          onChange={(v) => save({ fontHeading: v as HeadingFont })}
          preview={(f) => (
            <span className="text-base text-slate-900" style={f ? { fontFamily: f.family, fontWeight: f.weight, fontSizeAdjust: "adjust" in f ? f.adjust : undefined } : { fontFamily: "var(--font-body)", fontWeight: 600 }}>
              Checkout regression
            </span>
          )}
        />
      </div>
    </div>
  );
}

type FontOption = (typeof FONTS)[number];

/** One compact font choice: a grouped dropdown and a preview in the chosen font. */
function FontPicker({
  id,
  label,
  help,
  value,
  options,
  sameAsText,
  onChange,
  preview,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  options: readonly FontOption[];
  sameAsText?: boolean;
  onChange: (id: string) => void;
  preview: (font: FontOption | undefined) => React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-900">
        {label}
      </label>
      <p className="mb-1.5 text-xs text-slate-500">{help}</p>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
        {sameAsText && <option value="body">Same as text</option>}
        {FONT_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {options
              .filter((f) => f.group === g)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
      <p className="mt-1.5 truncate rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">{preview(options.find((f) => f.id === value))}</p>
    </div>
  );
}

type ThemeDef = (typeof THEMES)[number];

/** A theme's colors as a small strip: page and panels, or bars, page and panels. */
function Swatch({ t, dark, small }: { t: ThemeDef; dark: boolean; small?: boolean }) {
  return (
    <span aria-hidden="true" className={cx("flex shrink-0 overflow-hidden rounded ring-1 ring-black/15 ring-inset", small ? "h-4 w-7" : "h-6 w-11")}>
      {(dark ? t.dark : t.light).map((c, i) => (
        <span key={i} className="flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

/**
 * One color, two colors or three colors, as collapsible groups. The group holding
 * your current choice starts open; closed ones show a strip of their swatches.
 */
function ColorPicker({ value, mode, onChange }: { value: Accent; mode: ThemeMode; onChange: (a: Accent) => void }) {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(m.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const dark = mode === "dark" || (mode === "system" && systemDark);
  const groupOf = (v: string) => THEMES.find((t) => t.id === v)?.colors ?? 1;
  const groups = [
    { n: 1, label: "One color", help: "One accent color; the grays lean toward it." },
    { n: 2, label: "Two colors", help: "One color for the page, one for the bars and panels." },
    { n: 3, label: "Three colors", help: "Bold top bar and menu, a page color and a panel color." },
  ] as const;
  const [open, setOpen] = useState<Set<number>>(() => new Set([groupOf(value)]));
  const toggle = (n: number, isOpen: boolean) =>
    setOpen((o) => {
      const next = new Set(o);
      if (isOpen) next.add(n);
      else next.delete(n);
      return next;
    });

  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {groups.map((g) => {
        const themes = THEMES.filter((t) => t.colors === g.n);
        const holdsCurrent = groupOf(value) === g.n;
        return (
          <details key={g.n} open={open.has(g.n)} onToggle={(e) => toggle(g.n, e.currentTarget.open)} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
              <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90">
                <path d="M7.2 4.2a.75.75 0 0 1 1.06 0l5.25 5.27a.75.75 0 0 1 0 1.06L8.26 15.8a.75.75 0 1 1-1.06-1.06L11.92 10 7.2 5.27a.75.75 0 0 1 0-1.06Z" />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">
                  <Sp>{g.label}</Sp>
                  {holdsCurrent && <span className="ml-2 text-xs font-normal text-accent-700">Your theme</span>}
                </span>
                <span className="block text-xs text-slate-500">
                  <Sp>{g.help}</Sp>
                </span>
              </span>
              <span className="flex gap-1 group-open:hidden">
                {g.n === 1
                  ? ACCENTS.map((c) => <span key={c.id} aria-hidden="true" className="size-4 rounded-full" style={{ background: `oklch(0.51 0.2 ${c.hue})` }} />)
                  : themes.map((t) => <Swatch key={t.id} t={t} dark={dark} small />)}
              </span>
            </summary>
            <div className="px-3 pt-0.5 pb-3">
              {g.n === 1 ? (
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((c) => (
                    <label key={c.id} className={cx(option(value === c.id), "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-slate-700")}>
                      <input type="radio" name="theme-accent" value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} className="sr-only" />
                      <span aria-hidden="true" className="h-5 w-5 rounded-full" style={{ background: `oklch(0.51 0.2 ${c.hue})` }} />
                      {c.label}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {themes.map((t) => (
                    <label key={t.id} className={cx(option(value === t.id), "flex items-center gap-2.5 px-2.5 py-2")}>
                      <input type="radio" name="theme-accent" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} className="sr-only" />
                      <Swatch t={t} dark={dark} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{t.label}</span>
                        <span className="block text-slate-500">{t.sub}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
