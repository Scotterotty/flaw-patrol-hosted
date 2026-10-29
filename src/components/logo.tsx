// The Flaw Patrol octopus emblem. Source art: public/brand.
export function Logo({ size = 32 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/flaw-patrol-mark.webp" width={size} height={size} alt="" aria-hidden="true" className="shrink-0 rounded-full" />;
}

/** Full logo with wordmark, on its own dark background. */
export function LogoBanner() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/flaw-patrol-logo.webp" width={1000} height={533} alt="Flaw Patrol, test management system" className="block h-auto w-full" />;
}
