import { describe, expect, it } from "vitest";
import { withHistory, type TemplateBug } from "./bug-template";

const bug = (repros: string, reproRate: string) =>
  ({ history: { dateTime: "", client: "", csp: "", context: "", user: "", envTenant: "", repros }, reproRate }) as unknown as TemplateBug;

describe("Repro rate follows Repros", () => {
  it("copies Repros even when the two started different (Write a bug: blank Repros, Repro rate 1/1)", () => {
    expect(withHistory(bug("", "1/1"), "repros", "3/5", false).reproRate).toBe("3/5");
  });
  it("keeps following as Repros is typed", () => {
    let b = bug("1/1", "1/1");
    for (const v of ["", "3", "3/", "3/5"]) b = withHistory(b, "repros", v, false);
    expect(b.reproRate).toBe("3/5");
    expect(b.history.repros).toBe("3/5");
  });
  it("leaves a Repro rate typed by hand alone", () => {
    expect(withHistory(bug("1/1", "2 of 10"), "repros", "3/5", true).reproRate).toBe("2 of 10");
  });
  it("other boxes don't touch Repro rate", () => {
    expect(withHistory(bug("1/1", "1/1"), "csp", "45.12.0", false).reproRate).toBe("1/1");
  });
});
