import { describe, expect, it } from "vitest";
import { pickRelease } from "./rc-status";

// ver_87 (#26): the Stories report opens on the release the newest test cycles test.
describe("pickRelease", () => {
  const jira = ["RC 23", "RC 22", "RC 21"];
  it("uses the release asked for in the link", () => expect(pickRelease(jira, "RC 21", ["RC 22"])).toBe("RC 21"));
  it("opens on the newest cycles' RC, ignoring case and spaces", () => expect(pickRelease(jira, undefined, ["rc22"])).toBe("RC 22"));
  it("opens on All when Jira has no release by that name", () => expect(pickRelease(jira, undefined, ["4.3"])).toBeNull());
  it("opens on All when there's no RC yet", () => expect(pickRelease(jira, undefined, [])).toBeNull());
  it("All in the link wins", () => expect(pickRelease(jira, "all", ["RC 22"])).toBeNull());
  it("an unknown release in the link falls back to the newest cycles' RC", () => expect(pickRelease(jira, "RC 9", ["RC 22"])).toBe("RC 22"));
});
