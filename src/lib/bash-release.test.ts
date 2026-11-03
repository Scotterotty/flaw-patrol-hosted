import { describe, expect, it } from "vitest";
import { matchRelease, releaseChoices, releaseHint } from "./bash";

describe("bash releases (ver_152)", () => {
  it("lists each release once, newest first, skipping blanks", () => {
    expect(releaseChoices(["RC 22", "", "rc22", "2.4.0", " 2.4.0 ", "2.3.1"])).toEqual(["RC 22", "2.4.0", "2.3.1"]);
  });

  it("matches a release however it's spelled, as offered", () => {
    expect(matchRelease("rc-22", ["RC 22", "2.4.0"])).toBe("RC 22");
    expect(matchRelease("9.9", ["RC 22"])).toBe("");
    expect(matchRelease("", ["RC 22"])).toBe("");
  });

  it("says where its bugs show, with the bash's platforms", () => {
    expect(releaseHint("2.4.0", ["Web", "iOS"])).toBe("Its bugs show on the 2.4.0 Release status report, for the platforms this bash lists: Web, iOS.");
    expect(releaseHint("2.4.0", [])).toBe("Its bugs show on the 2.4.0 Release status report.");
    expect(releaseHint("", ["Web"])).toBe("Kept on its own. It doesn't show on any release's report.");
  });
});
