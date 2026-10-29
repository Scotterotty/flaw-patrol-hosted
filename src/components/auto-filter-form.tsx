"use client";

import { useRouter } from "next/navigation";
import { useRef, type ComponentProps } from "react";

/**
 * A GET filter form that applies itself: a dropdown as soon as it changes,
 * typing after a short pause. Enter still applies at once.
 */
export function AutoFilterForm({ children, ...props }: ComponentProps<"form">) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apply = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const data = new FormData(form.current!);
    const params = new URLSearchParams();
    for (const [k, v] of data) if (typeof v === "string" && v !== "") params.append(k, v);
    const query = params.toString();
    router.replace(query ? `?${query}` : window.location.pathname, { scroll: false });
  };
  const later = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(apply, 450);
  };
  return (
    <form
      {...props}
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      onChange={(e) => (e.target instanceof HTMLSelectElement ? apply() : later())}
    >
      {children}
    </form>
  );
}
