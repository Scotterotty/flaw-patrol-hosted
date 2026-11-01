import { describe, expect, it } from "vitest";
import { bashEmail, bashSlackLines, runEmail, runSlackLines, runSubject, tookText, vsText, type BashDigest, type RunDigest } from "./digest-render";
import { cleanEmail, digestSummary, memberGets, parseDigestSettings, parsePrefs, PREF_DEFAULTS, stopPrefs } from "./digest-settings";
import { parseAlerts } from "./slack-alerts";

const run: RunDigest = {
  where: "Release 4.2 · iOS",
  runName: "Smoke test",
  build: "4.2.0 (318)",
  took: "3 h 20 min",
  when: "Oct 31, 12:52 PM to 4:12 PM",
  closedNotRun: 0,
  total: 50,
  done: 48,
  passed: 41,
  failed: 5,
  blocked: 2,
  passPct: 85,
  vsLast: -7,
  regressions: 2,
  failures: [
    { key: "MA-87", title: "Push notification opens the right screen", regression: false, tester: "Jordan", bug: { key: "MOB-2294", url: null } },
    { key: "MA-112", title: "Log in with Apple", regression: true, tester: "Sam", bug: { key: "MOB-2293", url: "https://jira.example.com/browse/MOB-2293" } },
    { key: "MA-90", title: "Deep link from email", regression: false, tester: "Jordan", bug: null },
    { key: "MA-140", title: "Checkout with <saved> card", regression: true, tester: "Priya", bug: null },
    { key: "MA-151", title: "Change language mid-session", regression: false, tester: "Sam", bug: null },
  ],
  blockedCases: [
    { key: "MA-60", comment: "Staging payments down" },
    { key: "MA-61", comment: "Staging payments down" },
  ],
  bugs: [{ key: "MOB-2291", url: null, title: "Checkout spinner never stops", severity: "B - Critical", serious: true }],
  testers: ["Priya", "Sam", "Jordan"],
  runUrl: "http://localhost:3000/p/MA1/runs/4",
  firstFailUrl: "http://localhost:3000/p/MA1/runs/4/execute?entry=e1",
};

describe("Digest settings", () => {
  it("are off until saved, and clean addresses", () => {
    expect(parseDigestSettings(null).on).toBe(false);
    const s = parseDigestSettings({ on: true, addresses: ["Producer@Example.com", "nope", "producer@example.com"], groupIds: ["g1"] });
    expect(s.addresses).toEqual(["producer@example.com"]);
    expect(digestSummary(s, ["Mobile leads"])).toBe("Run finished, Bug bash ended and Release testing done to people who tested or joined, whoever started it, Mobile leads and 1 address");
    expect(digestSummary(parseDigestSettings({}), [])).toMatch(/^Off\./);
  });
  it("reads only plain email addresses", () => {
    expect(cleanEmail(" A@B.co ")).toBe("a@b.co");
    expect(cleanEmail("a@b")).toBeNull();
    expect(cleanEmail("Ann <a@b.co>")).toBeNull();
  });
  it("lets each person's choice win", () => {
    expect(parsePrefs({})).toEqual(PREF_DEFAULTS);
    expect(memberGets(PREF_DEFAULTS, "run", true)).toBe(true);
    expect(memberGets(PREF_DEFAULTS, "run", false)).toBe(false);
    expect(memberGets({ ...PREF_DEFAULTS, runs: "all" }, "run", false)).toBe(true);
    expect(memberGets({ ...PREF_DEFAULTS, runs: "none" }, "run", true)).toBe(false);
    expect(memberGets({ ...PREF_DEFAULTS, bashes: "none" }, "bash", true)).toBe(false);
    expect(memberGets({ ...PREF_DEFAULTS, rc: false }, "rc", true)).toBe(false);
    expect(stopPrefs(PREF_DEFAULTS, "bash")).toEqual({ runs: "tested", bashes: "none", rc: true });
  });
});

describe("Run digest", () => {
  it("lists 3 failures in Slack, regressions first, and escapes what people typed", () => {
    const lines = runSlackLines(run);
    expect(lines[0]).toBe("*Smoke test* · build 4.2.0 (318) · took 3 h 20 min");
    expect(lines[1]).toBe("48 run · 41 passed · 5 failed · 2 blocked · 85% pass · ▼ 7% vs last run");
    const fails = lines.slice(lines.indexOf("*What failed*") + 1, lines.indexOf("*What failed*") + 5);
    expect(fails).toEqual(["MA-112 Log in with Apple · *REGRESSION*", "MA-140 Checkout with &lt;saved&gt; card · *REGRESSION*", "MA-87 Push notification opens the right screen", "…and 2 more"]);
    expect(lines).toContain("MOB-2291 B - Critical · Checkout spinner never stops");
    expect(lines.at(-1)).toBe("Tested by Priya, Sam and Jordan");
  });
  it("puts the result in the subject and every failure in the email", () => {
    expect(runSubject(run)).toBe("Smoke test on Release 4.2 · iOS finished: 85% pass, 2 regressions");
    const m = runEmail(run, { reason: "You get this because you tested in this run.", prefsUrl: "http://x/account#emails", stopUrl: "http://x/stop-emails?t=1", stopLabel: "Stop run emails" });
    for (const f of run.failures) expect(m.text).toContain(f.key);
    expect(m.html).toContain("Checkout with &lt;saved&gt; card");
    expect(m.html).toContain('href="https://jira.example.com/browse/MOB-2293"');
    expect(m.text).toContain('Blocked: MA-60 and MA-61 ("Staging payments down").');
    expect(m.text).toContain("Stop run emails: http://x/stop-emails?t=1");
  });
  it("says how long and how it compares", () => {
    expect(tookText(45 * 60_000)).toBe("45 min");
    expect(tookText(200 * 60_000)).toBe("3 h 20 min");
    expect(tookText(3 * 24 * 60 * 60_000)).toBe("3 days");
    expect(vsText(4)).toBe("▲ 4% vs last run");
    expect(vsText(null)).toBe("");
  });
});

describe("Bug bash digest", () => {
  const bash: BashDigest = {
    name: "Checkout",
    people: 7,
    length: "1 hour",
    when: "Fri, Oct 31 2:00 to 3:00 PM",
    bugs: 12,
    high: 2,
    notes: 4,
    ideas: 2,
    worst: [{ key: "MOB-2301", url: null, severity: "Blocker", text: "Card form accepts expired dates" }],
    byArea: [
      { name: "Payments", bugs: 5 },
      { name: "Cart", bugs: 4 },
      { name: "Empty", bugs: 0 },
    ],
    unanswered: 1,
    notFiled: 2,
    topFinder: { name: "Alex", bugs: 4 },
    trophy: true,
    reportUrl: "http://x/report",
  };
  it("matches the mockup's Slack post", () => {
    expect(bashSlackLines(bash)).toEqual([
      "7 people · 1 hour · 12 bugs (2 High or Blocker) · 4 notes · 2 ideas",
      "",
      "*Worst finds*",
      "MOB-2301 Blocker · Card form accepts expired dates",
      "",
      "*By area*",
      "Payments 5 · Cart 4",
      "",
      "*Still to do*",
      "1 question not answered · 2 bugs not filed yet",
      "",
      "Most bugs: Alex (4) 🏆",
    ]);
    expect(bashEmail(bash, { reason: "r", prefsUrl: null, stopUrl: "s", stopLabel: "Stop these emails" }).subject).toBe("Checkout bug bash ended: 12 bugs (2 High or Blocker)");
  });
});

describe("Slack alert choices", () => {
  it("default to the longer posts and the new Bug bash ended alert", () => {
    expect(parseAlerts({})).toMatchObject({ bash: true, runDetail: true, bashDetail: true });
    expect(parseAlerts({ runDetail: false }).runDetail).toBe(false);
  });
});
