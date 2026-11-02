import { describe, expect, it } from "vitest";
import { adfHeadings, browserContext, clientIn, effectiveTemplate, exampleValue, pickPriority, friendlyNames, featureOf, guessField, guessSection, importedTitle, isDxdiag, orderFiles, parseTemplateSettings, tagOf, templateKind, templateTitle, tenantOf, titlePattern, type TemplateBug } from "./bug-template";
import { HISTORY_HEADERS, templateAdf } from "./jira-format";

const bug: TemplateBug = {
  clientTag: "UNREAL",
  feature: "Assets Panel",
  brief: "Deleted asset stays in the panel",
  observedOn: "Unreal client, o2QA",
  clientsNeeded: "1",
  what: "The asset is still listed.",
  slack: "",
  history: { dateTime: "2026/10/23\n15:42:10", client: "Unreal\n2.22.0", csp: "0.22.1", context: "Windows 11", user: "ryan.qa\nusr_1", envTenant: "o2QA\nmagnopus-qa", repros: "3/3" },
  reproSteps: "1. Open\n2. Delete",
  spaceLink: "",
  impact: "",
  workaround: "",
  reproRate: "3/3",
  build: "Version 2.22.0 - CSP 0.22.1",
  clients: ["Unreal"],
  team: "Unreal",
  olyEnv: ["o2QA"],
};

const json = (n: unknown) => JSON.stringify(n);

describe("team bug template", () => {
  it("builds the [CLIENT] - Feature - summary title", () => {
    expect(templateTitle(bug)).toBe("[UNREAL] - Assets Panel - Deleted asset stays in the panel");
    expect(templateTitle({ clientTag: "[WEB]", feature: "", brief: "Broken" })).toBe("[WEB] - Broken");
  });
  it("reads the tag and feature from a qTest-style case name", () => {
    expect(tagOf("[UNREAL] - In Space - UI - Assets Panel")).toBe("UNREAL");
    expect(featureOf("[UNREAL] - In Space - UI - Assets Panel")).toBe("Assets Panel");
    expect(featureOf("Checkout")).toBe("Checkout");
    expect(tagOf("Checkout")).toBe("");
  });
  it("finds the client in a project name", () => {
    expect(clientIn("OKO Unreal RC22")).toBe("Unreal");
    expect(clientIn("OKO Web Mobile")).toBe("Web Mobile");
    expect(clientIn("Webhooks")).toBe("");
  });
  it("sorts screenshots and videos before logs, and spots dxdiag", () => {
    const files = [
      { fileName: "client.log", contentType: "text/plain" },
      { fileName: "a.png", contentType: "image/png" },
      { fileName: "b.mp4", contentType: "video/mp4" },
    ];
    expect(orderFiles(files).media.map((f) => f.fileName)).toEqual(["a.png", "b.mp4"]);
    expect(orderFiles(files).logs.map((f) => f.fileName)).toEqual(["client.log"]);
    expect(isDxdiag("DxDiag.txt")).toBe(true);
    expect(isDxdiag("client.log")).toBe(false);
  });
  it("gives random file names a friendly one and keeps the rest", () => {
    const names = friendlyNames(
      [
        { fileName: "5ee7591c-b887-41c6-a13c-1cad88ac1c3c_video.mp4", contentType: "video/mp4" },
        { fileName: "a1b2c3d4e5f60718293a.png", contentType: "image/png" },
        { fileName: "delete-after.png", contentType: "image/png" },
        { fileName: "0f1e2d3c4b5a69788796a5b4.mp4", contentType: "video/mp4" },
        { fileName: "DxDiag.txt", contentType: "text/plain" },
      ],
      { clientTag: "UNREAL", feature: "Assets Panel" },
    ).map((f) => f.fileName);
    expect(names).toEqual(["UNREAL_Assets-Panel_video-1.mp4", "UNREAL_Assets-Panel_screenshot-1.png", "delete-after.png", "UNREAL_Assets-Panel_video-2.mp4", "DxDiag.txt"]);
  });
  it("keeps the tenant lines and reads browsers", () => {
    expect(tenantOf("o2QA\nmagnopus-qa")).toBe("magnopus-qa");
    expect(browserContext("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe("Chrome 141\nWindows");
  });
  it("parses saved settings defensively", () => {
    expect(parseTemplateSettings(null).on).toBe(false);
    expect(parseTemplateSettings({ on: true, clients: ["Unreal", 4] })).toMatchObject({ on: true, clients: ["Unreal"] });
  });
});

describe("template description", () => {
  const files = [
    { fileName: "client.log", contentType: "text/plain", url: "https://j/secure/attachment/3/client.log" },
    { fileName: "DxDiag.txt", contentType: "text/plain", url: "https://j/secure/attachment/4/DxDiag.txt" },
    { fileName: "a.png", contentType: "image/png", url: "https://j/secure/attachment/1/a.png", mediaId: "11111111-2222-3333-4444-555555555555" },
  ];
  it("puts the parts in the OB-5292 order, with attachments above the history", () => {
    const s = json(templateAdf(bug, { files }));
    const at = (t: string) => s.indexOf(t);
    expect(at("Issue Observed on: ")).toBeLessThan(at("Clients Needed for Repro: "));
    expect(at("The asset is still listed.")).toBeLessThan(at("SCREENSHOTS & VIDEOS"));
    expect(at("SCREENSHOTS & VIDEOS")).toBeLessThan(at("LOGS"));
    expect(at("LOGS")).toBeLessThan(at("REPRODUCTION HISTORY"));
    expect(s).toContain('"type":"mediaSingle"');
    for (const h of HISTORY_HEADERS) expect(s).toContain(h);
  });
  it("leaves THREADS out without a Slack link, and in with one", () => {
    expect(json(templateAdf(bug, { files: [] }))).not.toContain("THREADS");
    expect(json(templateAdf({ ...bug, slack: "https://x.slack.com/archives/C1/p2" }, { files: [] }))).toContain("THREADS");
  });
  it("lists every file but the dxdiag in the history's Attachments column", () => {
    const adf = templateAdf(bug, { files }) as { content: { type: string; content?: unknown[] }[] };
    const table = json(adf.content.find((n) => n.type === "expand"));
    expect(table).toContain("client.log");
    expect(table).toContain("a.png");
    expect(table).not.toContain("DxDiag.txt");
  });
  it("carries fields Jira lacks, and the tester's name when they can't be the reporter", () => {
    const s = json(templateAdf(bug, { files: [], reportedBy: "Ryan", extra: [{ name: "Team", text: "Unreal" }] }));
    expect(s).toContain("Reported by: ");
    expect(s).toContain('"text":"Team"');
  });
  it("adds a Flaw Patrol trace link at the end when given one", () => {
    const s = json(templateAdf(bug, { files: [], trace: { label: 'PQ-1 in run R4 "RC22"', link: "https://fp/x" } }));
    expect(s).toContain("Filed from Flaw Patrol: ");
    expect(s).toContain("https://fp/x");
  });
});

describe("importing a template from an example bug", () => {
  it("reads the title shape", () => {
    expect(titlePattern("[MOBILE] - Login - Password field hides")).toMatchObject({ tag: true, feature: true, example: { tag: "MOBILE", feature: "Login" } });
    expect(titlePattern("Login - Password field hides")).toMatchObject({ tag: false, feature: true });
    expect(titlePattern("Password field hides")).toMatchObject({ tag: false, feature: false });
    expect(importedTitle({ tag: true, feature: true }, { tag: "", feature: "Login", summary: "Broken" })).toBe("Login - Broken");
  });

  it("finds headings and bold-only lines, never the example's text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "Steps to Reproduce" }] },
        { type: "paragraph", content: [{ type: "text", text: "1. Open the app" }] },
        { type: "paragraph", content: [{ type: "text", text: "Expected Result:", marks: [{ type: "strong" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Bold ", marks: [{ type: "strong" }] }, { type: "text", text: "then plain" }] },
      ],
    };
    expect(adfHeadings(doc)).toEqual(["Steps to Reproduce", "Expected Result"]);
    expect(guessSection("Steps to Reproduce")).toBe("steps");
    expect(guessSection("Expected Result")).toBe("expected");
    expect(guessSection("Notes")).toBe("tester");
  });

  it("guesses field sources and reads example values", () => {
    expect(guessField("Severity", true)).toBe("tester");
    expect(guessField("Found in version", true)).toBe("release");
    expect(guessField("Component", true)).toBe("default");
    expect(guessField("Labels", true)).toBe("empty");
    expect(exampleValue([{ name: "Mobile app" }])).toEqual(["Mobile app"]);
    expect(exampleValue({ value: "Always" })).toEqual(["Always"]);
    expect(exampleValue({ accountId: "x" })).toBeNull();
  });

  it("keeps an imported template through parsing", () => {
    const t = parseTemplateSettings({ on: true, imported: { from: "QA-418", title: { tag: true, feature: false }, sections: [{ heading: "Notes", source: "tester" }], fields: [{ id: "components", name: "Component", required: false, source: "default", value: ["Mobile app"] }] } });
    expect(templateKind(t)).toBe("imported");
    expect(t.imported?.fields[0].value).toEqual(["Mobile app"]);
    expect(templateKind(parseTemplateSettings({ on: true }))).toBe("detailed");
    expect(templateKind(parseTemplateSettings({ on: false, imported: { from: "QA-1" } }))).toBe("plain");
  });
});

describe("Jira Priority on new bugs", () => {
  const options = ["Highest", "High", "Medium", "Low", "Not Prioritized"];
  it("starts on Not Prioritized when Jira has it, matched however it's written", () => {
    expect(pickPriority(null, options)).toBe("Not Prioritized");
    expect(pickPriority(null, ["High", "not prioritized"])).toBe("not prioritized");
  });
  it("leaves it to Jira when Jira has no Not Prioritized, or when asked to", () => {
    expect(pickPriority(null, ["High", "Low"])).toBeNull();
    expect(pickPriority("", options)).toBeNull();
  });
  it("uses a picked priority only while Jira still lists it", () => {
    expect(pickPriority("High", options)).toBe("High");
    expect(pickPriority("Urgent", options)).toBeNull();
  });
  it("is kept with the settings, and stays this place's own under a shared template", () => {
    expect(parseTemplateSettings(null).priority).toBeNull();
    expect(parseTemplateSettings({ on: false, priority: "" }).priority).toBe("");
    expect(parseTemplateSettings({ on: true, priority: "Low" }).priority).toBe("Low");
    expect(effectiveTemplate({ priority: "High" }, { on: true, priority: "Low" }).priority).toBe("High");
  });
});
