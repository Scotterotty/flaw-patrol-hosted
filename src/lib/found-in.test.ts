import { describe, expect, it } from "vitest";
import { closestVersions, foundInDraft, foundInLine, foundInRelease, matchVersion, parseFoundIn, versionKey, type JiraVersion } from "./found-in";

const versions: JiraVersion[] = [
  { name: "RC 23", released: false },
  { name: "RC 22", released: false },
  { name: "2.4", released: false },
  { name: "RC 21", released: true },
];

describe("found-in version", () => {
  it("reads the saved setting", () => {
    expect(parseFoundIn({ field: "versions" })).toEqual({ field: "versions" });
    expect(parseFoundIn({ field: "fixVersions" })).toEqual({ field: "fixVersions" });
    expect(parseFoundIn({ field: "labels" })).toBeNull();
    expect(parseFoundIn(null)).toBeNull();
  });

  it("matches release names loosely", () => {
    expect(versionKey("RC-22")).toBe("rc22");
    expect(matchVersion(versions, "rc22")?.name).toBe("RC 22");
    expect(matchVersion(versions, "RC 22")?.name).toBe("RC 22");
    expect(matchVersion(versions, "2.4")?.name).toBe("2.4");
    // Dots count, so 2.4 is never 24.
    expect(matchVersion(versions, "24")).toBeNull();
    expect(matchVersion(versions, "  ")).toBeNull();
  });

  it("takes the run's release, then the bash's, then the test cycle's", () => {
    expect(foundInRelease({ run: " 2.4 ", bash: "RC 22", cycle: "RC 21" })).toEqual({ name: "2.4", source: "run" });
    expect(foundInRelease({ run: "", bash: "RC 22", cycle: "RC 21" })).toEqual({ name: "RC 22", source: "bash" });
    expect(foundInRelease({ run: "", bash: null, cycle: "RC 21" })).toEqual({ name: "RC 21", source: "cycle" });
    expect(foundInRelease({ run: "" })).toEqual({ name: "", source: "none" });
  });

  it("drafts the bug box line", () => {
    const d = foundInDraft({ field: "versions" }, versions, { name: "rc 22", source: "run" }, { onScreen: true, label: "Affects versions" });
    expect(d).toMatchObject({ value: "RC 22", known: true, release: "rc 22", current: ["RC 23", "RC 22", "2.4"], older: ["RC 21"] });
    const missing = foundInDraft({ field: "versions" }, versions, { name: "2.6 beta", source: "run" }, { onScreen: true });
    expect(missing).toMatchObject({ value: "2.6 beta", known: false, label: "Affects versions" });
    expect(closestVersions(missing)).toEqual(["RC 23", "RC 22"]);
    const none = foundInDraft({ field: "fixVersions" }, [], { name: "", source: "none" }, { onScreen: false });
    expect(none).toMatchObject({ value: "", known: true, label: "Fix versions", onScreen: false });
  });

  it("says in the description why the version isn't in its field", () => {
    expect(foundInLine("Affects versions", "2.6 beta", "missing")).toBe("Found in: 2.6 beta (not a version in Jira, so it isn't in Affects versions)");
    expect(foundInLine("Affects versions", "2.4", "refused")).toBe("Found in: 2.4 (Jira wouldn't take it in Affects versions)");
  });
});
