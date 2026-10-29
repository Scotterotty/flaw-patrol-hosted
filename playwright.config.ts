import { defineConfig } from "@playwright/test";

// End-to-end tests run against `next dev`.
export default defineConfig({
  testDir: "tests/e2e",
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
      command: "npx next dev -p 3100",
      // Pull from GitHub talks to the stand-in below instead of GitHub.
      // Microsoft sign-in talks to the stand-in in mock-sso.mjs (ver_92).
      // A bigger heap, so next dev doesn't restart itself mid-run ("approaching the used memory threshold").
      env: { GITHUB_API_URL: "http://localhost:3196", FP_MICROSOFT_AUTHORITY: "http://localhost:3195", NODE_OPTIONS: "--max-old-space-size=8192" },
      url: "http://localhost:3100/signin",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // Stand-in for Jira Cloud, used by execution.spec.ts.
    { command: "node tests/e2e/mock-jira.mjs", port: 3199, reuseExistingServer: !process.env.CI },
    { command: "node tests/e2e/mock-sentry.mjs", port: 3198, reuseExistingServer: !process.env.CI },
    // Stand-in for GitHub's API with Scott's demo repo, used by github.spec.ts.
    { command: "node tests/e2e/mock-github.mjs", port: 3196, reuseExistingServer: !process.env.CI },
    // Stand-ins for Microsoft / company sign-in and a mail server, used by ver92.spec.ts.
    { command: "node tests/e2e/mock-sso.mjs", port: 3195, reuseExistingServer: !process.env.CI },
  ],
});
