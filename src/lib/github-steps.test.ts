import { describe, expect, it } from "vitest";
import { buildSteps, pickAnnotation } from "./github-steps";

const step = (name: string, conclusion: string | null) => ({ name, conclusion });
const job = (steps: ReturnType<typeof step>[]) => [{ name: "test", html_url: "https://github.com/o/r/actions/runs/1/job/2", conclusion: "failure", steps }];
const house = (rest: ReturnType<typeof step>[]) => [step("Set up job", "success"), step("Run actions/checkout@v5", "success"), step("Run actions/setup-node@v5", "success"), ...rest, step("Run actions/upload-artifact@v6", "success"), step("Post Run actions/checkout@v5", "success"), step("Complete job", "success")];

describe("GitHub build steps", () => {
  it("hides housekeeping steps and keeps the workflow's own, in order", () => {
    const b = buildSteps(job(house([step("Install", "success"), step("Build", "success"), step("Run tests", "success"), step("Package", "success")])));
    expect(b.jobs[0].steps.map((s) => s.name)).toEqual(["Install", "Build", "Run tests", "Package"]);
    expect(b.sentence).toBeNull();
  });
  it("says the build broke before any tests ran", () => {
    const b = buildSteps(job(house([step("Install", "success"), step("Build", "failure"), step("Run tests", "skipped"), step("Package", "skipped")])), () => "Simulated compile error: unexpected token");
    expect(b.sentence).toBe("Build failed, so no tests ran");
    expect(b.noTests).toBe(true);
    expect(b.jobs[0].steps.map((s) => s.state)).toEqual(["pass", "fail", "skip", "skip"]);
    expect(b.message).toBe("Simulated compile error: unexpected token");
    expect(b.logUrl).toContain("/job/2");
  });
  it("names another step that failed along with the tests", () => {
    const b = buildSteps(job(house([step("Install", "success"), step("Build", "success"), step("Run tests", "failure"), step("Package", "failure")])));
    expect(b.sentence).toBe("Some tests failed, and Package also failed");
    expect(b.buildBroke).toBe(true);
  });
  it("says only tests failed", () => {
    const b = buildSteps(job(house([step("Run npm ci", "success"), step("Run tests", "failure")])));
    expect(b.sentence).toBe("Some tests failed");
    expect(b.buildBroke).toBe(false);
  });
  it("leaves out GitHub's generic exit code line", () => {
    expect(pickAnnotation([{ message: "Process completed with exit code 1.", annotation_level: "failure" }, { message: "couldn't write app.zip (disk full)\nmore", annotation_level: "failure" }])).toBe("couldn't write app.zip (disk full)");
    expect(pickAnnotation([{ message: "Process completed with exit code 1.", annotation_level: "failure" }])).toBeNull();
  });
});
