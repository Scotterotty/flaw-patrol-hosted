import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Small set of shared building blocks in the spirit of shadcn/ui.

export function cx(...parts: (string | false | null | undefined)[]) {
  return twMerge(parts.filter(Boolean).join(" "));
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm disabled:bg-accent-500/60",
  secondary: "bg-surface text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-surface text-red-700 border border-red-200 hover:bg-red-50",
};
const SIZE = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3.5 text-sm" };

export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed disabled:opacity-60",
    VARIANT[variant],
    SIZE[size],
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button type="button" className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function LinkButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...props} />;
}

const field =
  "block w-full rounded-md border border-slate-300 bg-surface px-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none disabled:bg-slate-100";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(field, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(field, "py-1.5 leading-relaxed", className)} {...props} />;
}

// Inline dropdowns use w-auto max-w-full (plus min-w-* for long names), never a
// fixed width: fonts differ in width and a fixed one cuts text off ("Membe").
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(field, "h-9 pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cx("mb-1 block text-xs font-medium text-slate-600", className)} {...props} />;
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const TONE = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
};
export type Tone = keyof typeof TONE;

export function Badge({ tone = "gray", className, children, "data-testid": testId }: { tone?: Tone; className?: string; children: ReactNode; "data-testid"?: string }) {
  return (
    <span data-testid={testId} className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-lg border border-slate-200 bg-surface shadow-sm", className)} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-surface px-6 py-12 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { ErrorText } from "./error-text";

/** A small ⓘ that explains something on hover or focus. Explanations stay out of the page itself. */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      title={text}
      aria-label={text}
      className={cx("inline-grid size-[18px] cursor-help place-items-center rounded-full border border-slate-300 align-middle text-[11px] leading-none font-semibold text-slate-500 hover:border-accent-500 hover:text-accent-700", className)}
    >
      i
    </span>
  );
}

/** A form field with an ⓘ beside its label. The tip sits outside the <label>, so the label names only the field. */
export function TipField({ label, htmlFor, tip, className, children }: { label: ReactNode; htmlFor: string; tip?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx("grid gap-1", className)}>
      <div className="flex items-center gap-1 text-xs font-medium text-slate-600">
        <label htmlFor={htmlFor}>{label}</label>
        {tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  );
}
