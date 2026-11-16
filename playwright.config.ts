import { defineConfig } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { SERVER_UPDATE_DIR } from "./tests/e2e/server-update-dir";

// End-to-end tests run against `next dev`, or with E2E_SERVER=prod against a production build
// (`next build` first), which is faster and never restarts mid-test. `npm run e2e:all` does it all:
// preflight (scripts/e2e-preflight.mjs), every spec on the production build, then DEV_ONLY on next dev.
const server = process.env.E2E_SERVER ?? "dev";
// These post to localhost hooks, which production builds refuse on purpose.
export const DEV_ONLY = ["run-sheet.spec.ts", "sheet-fill.spec.ts", "ver82.spec.ts"];
// The preflight makes a fresh database for each run and names it here; the servers and specs use it instead of .env's.
if (existsSync(".e2e-database")) process.env.DATABASE_URL = readFileSync(".e2e-database", "utf8").trim();
// Workspace settings → Updates talks to the update helper through this folder; ver239.spec.ts plays the helper.
mkdirSync(SERVER_UPDATE_DIR, { recursive: true });

// E2E_SSO_ONLY=1 starts the server as the hosted company-sign-in-only setup (sso-only.spec.ts).
const ssoOnlyEnv: Record<string, string> = process.env.E2E_SSO_ONLY
  ? { AUTH_SSO_ONLY: "true", AUTH_ADMIN_EMAILS: "boss-sso@example.com", AUTH_MICROSOFT_TENANT_ID: "4f2a1c3e-0b7d-4e21-9a55-1d2f3c4b5a6e", AUTH_MICROSOFT_ID: "flaw-patrol-e2e", AUTH_MICROSOFT_SECRET: "e2e-secret", AUTH_ALLOWED_DOMAINS: "example.com" }
  : {};
// E2E_FUN_OFF=1 starts the server with the fun features switched off (fun-off.spec.ts).
const funOffEnv: Record<string, string> = process.env.E2E_FUN_OFF ? { FUN_FEATURES: "off" } : {};

export default defineConfig({
  testDir: "tests/e2e",
  ...(server === "prod" ? { testIgnore: DEV_ONLY.map((f) => `**/${f}`) } : {}),
  timeout: 180_000,
  // The dev server compiles each page on first visit.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    // Point at a preinstalled Chromium instead of downloading one, if you have it.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: server === "prod" ? "npx next start -p 3100" : "npx next dev -p 3100",
      // Pull from GitHub talks to the stand-in below instead of GitHub.
      // Microsoft sign-in talks to the stand-in in mock-sso.mjs (ver_92).
      // AUTH_URL: sign-in sends people back to this server, not the 3000 one in .env.
      // A bigger heap, so next dev doesn't restart itself mid-run ("approaching the used memory threshold").
      env: { AUTH_URL: "http://localhost:3100", OUTBOUND_ALLOW_HOSTS: "localhost,127.0.0.1", GITHUB_API_URL: "http://localhost:3196", QASE_API_URL: "http://localhost:3192/v1", FP_MICROSOFT_AUTHORITY: "http://localhost:3195", SERVER_UPDATE_DIR, NODE_OPTIONS: "--max-old-space-size=8192", ...ssoOnlyEnv, ...funOffEnv },
      url: "http://localhost:3100/signin",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // Stand-in for Jira Cloud, used by execution.spec.ts.
    { command: "node tests/e2e/mock-jira.mjs", port: 3199, reuseExistingServer: !process.env.CI },
    { command: "node tests/e2e/mock-sentry.mjs", port: 3193, reuseExistingServer: !process.env.CI },
    // Stand-in for GitHub's API with Scott's demo repo, used by github.spec.ts.
    { command: "node tests/e2e/mock-github.mjs", port: 3196, reuseExistingServer: !process.env.CI },
    // Stand-in for a TeamCity server, used by status.spec.ts (ver_228).
    { command: "node tests/e2e/mock-teamcity.mjs", port: 3191, reuseExistingServer: !process.env.CI },
    // Stand-in for Qase's API, used by ver164.spec.ts.
    { command: "node tests/e2e/mock-qase.mjs", port: 3192, reuseExistingServer: !process.env.CI },
    // Stand-ins for Microsoft / company sign-in and a mail server, used by ver92.spec.ts.
    { command: "node tests/e2e/mock-sso.mjs", port: 3195, reuseExistingServer: !process.env.CI },
  ],
});
