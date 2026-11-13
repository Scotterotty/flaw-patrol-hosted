import { describe, expect, it } from "vitest";
import { buildNumber, helperRunning, logTail, parseCommits, parseKeyValues, parseMigrations, parseRemote, parseStatus, updateBlocked, type ServerUpdateView } from "./server-update";

// The files the update helper (scripts/server-update.sh) writes, read back by Workspace settings → Updates.

const base: ServerUpdateView = { problem: null, helperSeen: null, status: null, remote: null, commits: [], migrations: [], waiting: null, log: "" };

describe("parseKeyValues", () => {
  it("reads key=value lines, keeps = inside values and skips junk", () => {
    expect(parseKeyValues("state=done\r\nmessage=Updated from a=1 to b\nnot a pair\n=empty key\n")).toEqual({ state: "done", message: "Updated from a=1 to b" });
  });
});

describe("parseStatus", () => {
  it("reads a finished run", () => {
    const s = parseStatus("state=done\nid=abc123\nby=Scott Smith\nstep=\nmessage=Updated from 0.3.0-alpha.237 to 0.3.0-alpha.240.\nstarted=2026-11-13T17:00:00Z\nfinished=2026-11-13T17:04:10Z\nfrom=0.3.0-alpha.237\nto=0.3.0-alpha.240\nbackup=/srv/fp/backups/x.dump\nseen=2026-11-13T17:04:10Z\n");
    expect(s).toMatchObject({ state: "done", by: "Scott Smith", from: "0.3.0-alpha.237", to: "0.3.0-alpha.240", finished: "2026-11-13T17:04:10Z" });
  });
  it("treats an unknown state as idle and bad dates as missing", () => {
    expect(parseStatus("state=rm -rf\nseen=yesterday")).toMatchObject({ state: "idle", seen: null });
  });
});

describe("parseRemote", () => {
  it("reads counts and changed files", () => {
    const r = parseRemote("checked=2026-11-13T17:00:00Z\ncurrent=0.3.0-alpha.237\nlatest=0.3.0-alpha.240\nlatestCommit=88294b4\nbehind=12\nahead=0\nchanged=docker-compose.hosting.yml README.md\nerror=\n");
    expect(r).toMatchObject({ behind: 12, ahead: 0, latest: "0.3.0-alpha.240", changed: ["docker-compose.hosting.yml", "README.md"], error: "" });
  });
  it("keeps GitHub's error and treats missing counts as 0", () => {
    expect(parseRemote("checked=2026-11-13T17:00:00Z\nerror=Couldn't reach GitHub: Permission denied (publickey)")).toMatchObject({ behind: 0, error: "Couldn't reach GitHub: Permission denied (publickey)" });
  });
});

describe("parseCommits and parseMigrations", () => {
  it("keeps commit lines with a short hash and a tab", () => {
    expect(parseCommits("ff9aa0c\tVersion 236: sister cases\nnot a commit\n7c7a7a7\tSister cases: dry run\tresults\n")).toEqual([
      { sha: "ff9aa0c", subject: "Version 236: sister cases" },
      { sha: "7c7a7a7", subject: "Sister cases: dry run\tresults" },
    ]);
  });
  it("keeps only migration folder names", () => {
    expect(parseMigrations("20261113010000_bugs_picks\n\n../../etc/passwd\n20261113060000_sister_cases\n")).toEqual(["20261113010000_bugs_picks", "20261113060000_sister_cases"]);
  });
});

describe("helperRunning", () => {
  const now = new Date("2026-11-13T17:10:00Z");
  it("is running when it wrote in the last 2 minutes", () => {
    expect(helperRunning(parseStatus("state=idle\nseen=2026-11-13T17:09:00Z"), now)).toBe(true);
    expect(helperRunning(parseStatus("state=idle\nseen=2026-11-13T17:05:00Z"), now)).toBe(false);
  });
  it("allows a long quiet build while updating", () => {
    expect(helperRunning(parseStatus("state=updating\nseen=2026-11-13T17:00:00Z"), now)).toBe(true);
    expect(helperRunning(parseStatus("state=updating\nseen=2026-11-13T16:30:00Z"), now)).toBe(false);
  });
  it("is not running without a status", () => {
    expect(helperRunning(null, now)).toBe(false);
  });
});

describe("updateBlocked", () => {
  it("says why Update now can't be pressed", () => {
    expect(updateBlocked({ ...base, problem: "none" })).toMatch(/aren't set up/);
    expect(updateBlocked({ ...base, problem: "folder" })).toMatch(/folder/);
    expect(updateBlocked({ ...base, problem: "helper" })).toMatch(/isn't running/);
    expect(updateBlocked({ ...base, status: parseStatus("state=updating") })).toMatch(/already going/);
    expect(updateBlocked({ ...base, waiting: "update" })).toMatch(/Waiting/);
    expect(updateBlocked({ ...base, waiting: "check" })).toBeNull();
    expect(updateBlocked(base)).toBeNull();
  });
});

describe("buildNumber and logTail", () => {
  it("finds the build number", () => {
    expect(buildNumber("0.3.0-alpha.240")).toBe(240);
    expect(buildNumber("1.0.0")).toBeNull();
  });
  it("keeps the last lines without terminal colors", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n\x1b[31mred\x1b[0m\n";
    const tail = logTail(text, 3);
    expect(tail).toBe("line 98\nline 99\nred");
  });
});
