import { describe, expect, it } from "vitest";
import { alertSummary, atLeast, channelName, DEFAULT_ALERTS, parseAlerts, webhookProblem } from "./slack-alerts";

describe("Slack alerts", () => {
  it("defaults to regressions, serious bugs (B or worse), run finished and RC done", () => {
    expect(parseAlerts(null)).toEqual(DEFAULT_ALERTS);
    expect(alertSummary(DEFAULT_ALERTS)).toBe("Regression, Serious bug (B or worse), Run finished, Release testing done");
  });
  it("reads saved switches and ignores junk", () => {
    expect(parseAlerts({ reg: false, start: true, sev: "SHOWSTOPPER", bogus: 1 })).toMatchObject({ reg: false, start: true, sev: "SHOWSTOPPER", run: true });
    expect(parseAlerts({ sev: "NOPE" }).sev).toBe("CRITICAL");
  });
  it("compares severities", () => {
    expect(atLeast("SHOWSTOPPER", "CRITICAL")).toBe(true);
    expect(atLeast("CRITICAL", "CRITICAL")).toBe(true);
    expect(atLeast("PROBLEMATIC", "CRITICAL")).toBe(false);
  });
  it("accepts only Slack webhook links in production", () => {
    expect(webhookProblem("https://hooks.slack.com/services/T0/B0/xyz", true)).toBeNull();
    expect(webhookProblem("https://example.com/services/x", true)).toMatch(/isn't a Slack webhook/);
    expect(webhookProblem("http://localhost:3199/slack/a", true)).not.toBeNull();
    expect(webhookProblem("http://localhost:3199/slack/a", false)).toBeNull();
    expect(webhookProblem("not a link", true)).toMatch(/Paste the whole/);
  });
  it("names channels with one #", () => {
    expect(channelName("qa")).toBe("#qa");
    expect(channelName("##qa ")).toBe("#qa");
  });
});
