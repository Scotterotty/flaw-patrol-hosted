"use client";

/**
 * "Skip to content" (A4): the first Tab stop on every page. Hidden until it has focus;
 * Enter moves focus to the page's main area, so the next Tab lands on its first button.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>("main");
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start" });
      }}
      className="fixed top-2 left-2 z-[100] -translate-y-24 rounded-md bg-accent-600 px-3 py-2 text-sm font-semibold text-white shadow-lg ring-4 ring-accent-100 transition-transform focus:translate-y-0 focus:outline-none"
    >
      Skip to content
    </a>
  );
}
