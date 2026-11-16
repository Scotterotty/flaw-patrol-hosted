import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import pkg from "./package.json";

// Step-by-step replays open in Playwright's trace viewer, which isn't kept in git: make sure
// public/trace-viewer is there for every dev server and build, even right after a git pull.
const copyScript = join(process.cwd(), "scripts", "copy-trace-viewer.mjs");
if (existsSync(copyScript)) {
  try {
    execFileSync(process.execPath, [copyScript], { stdio: "inherit" });
  } catch {}
}

// Hosted build (backend team review: "No security headers on pages"). Kept to headers that
// can't break a page: no other site may show Flaw Patrol in a frame, browsers stick to https
// once they've seen it, links don't leak full addresses to other sites, and file types aren't guessed.
// A full script Content-Security-Policy is a later step (the trace viewer and embeds need care).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // `npm run release` packs this self-contained server into the ready-to-run build.
  // `node start.mjs --fast` runs `next start` instead, which doesn't need it (ver_129).
  output: process.env.FP_PLAIN_BUILD ? undefined : "standalone",
  // The version under Arrange menu order and in the name menu (ver_122). Inlined at build so client code needn't ship package.json.
  env: { APP_VERSION: pkg.version },
  experimental: {
    // Screen recordings attach up to 75 MB (other files stay at 10 MB, checked in uploadAttachment).
    serverActions: { bodySizeLimit: "80mb" },
    // Uploads pass through src/middleware.ts, which otherwise cuts request bodies off at 10 MB. Zips of automation results go up to 200 MB (ver_93).
    middlewareClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
