import { describe, expect, it } from "vitest";
import { keysInName, mergeFiles, parseResultsFile, titleFromTest } from "./automation";

const junit = `<?xml version="1.0"?>
<testsuites time="12.5">
  <testsuite name="Checkout" tests="3">
    <properties><property name="build" value="4812"/></properties>
    <testcase classname="Checkout.CartTests" name="ABC_12_AddItem" time="4.8">
      <failure message="Expected: 1 item But was: 0">at Checkout.CartTests.AddItem() line 88</failure>
      <system-out>hello</system-out>
    </testcase>
    <testcase classname="Search.Results" name="LoadBelow10s" time="30"><error message="Timeout of 30000ms exceeded"/></testcase>
    <testcase classname="Profile.Photo" name="UploadPng"><skipped/></testcase>
    <testcase classname="Profile.Photo" name="CropSquare" time="0.2"/>
  </testsuite>
</testsuites>`;

const nunit3 = `<test-run id="2" duration="3.5">
  <test-suite type="TestFixture" fullname="Game.MenuTests">
    <test-case name="OpensMenu" fullname="Game.MenuTests.OpensMenu" methodname="OpensMenu" classname="Game.MenuTests" result="Passed" duration="0.5"/>
    <test-case name="Saves" fullname="Game.MenuTests.Saves" methodname="Saves" classname="Game.MenuTests" result="Failed" label="Error" duration="1">
      <failure><message><![CDATA[NullReferenceException]]></message><stack-trace><![CDATA[at Game.Save()]]></stack-trace></failure>
      <output><![CDATA[log line]]></output>
    </test-case>
    <test-case name="Later" fullname="Game.MenuTests.Later" classname="Game.MenuTests" result="Skipped"><reason><message>not yet</message></reason></test-case>
  </test-suite>
</test-run>`;

describe("parseResultsFile", () => {
  it("reads JUnit results, messages and the build", () => {
    const f = parseResultsFile(junit, "TestResults-4812.xml");
    expect(f.format).toBe("junit");
    expect(f.build).toBe("4812");
    expect(f.durationSec).toBe(12.5);
    expect(f.tests.map((t) => [t.id, t.status, t.crashed])).toEqual([
      ["Checkout.CartTests.ABC_12_AddItem", "FAILED", false],
      ["Search.Results.LoadBelow10s", "FAILED", true],
      ["Profile.Photo.UploadPng", "SKIPPED", false],
      ["Profile.Photo.CropSquare", "PASSED", false],
    ]);
    expect(f.tests[0].message).toBe("Expected: 1 item But was: 0");
    expect(f.tests[0].stack).toContain("line 88");
    expect(f.tests[0].output).toBe("hello");
    expect(f.tests[0].durationMs).toBe(4800);
  });
  it("reads NUnit 3 (Unity) results", () => {
    const f = parseResultsFile(nunit3, "results.xml");
    expect(f.format).toBe("nunit");
    expect(f.tests.map((t) => [t.id, t.status, t.crashed])).toEqual([
      ["Game.MenuTests.OpensMenu", "PASSED", false],
      ["Game.MenuTests.Saves", "FAILED", true],
      ["Game.MenuTests.Later", "SKIPPED", false],
    ]);
    expect(f.tests[1].message).toBe("NullReferenceException");
    expect(f.tests[1].stack).toBe("at Game.Save()");
    expect(f.tests[1].output).toBe("log line");
    expect(f.tests[2].message).toBe("not yet");
  });
  it("reads NUnit 2 results", () => {
    const f = parseResultsFile(`<test-results><test-suite><results><test-case name="A.B.C" executed="True" result="Success" success="True" time="0.1"/><test-case name="A.B.D" executed="True" result="Failure" success="False"><failure><message>no</message><stack-trace>at D</stack-trace></failure></test-case><test-case name="A.B.E" executed="False" result="Ignored"/></results></test-suite></test-results>`);
    expect(f.tests.map((t) => [t.id, t.status])).toEqual([
      ["A.B.C", "PASSED"],
      ["A.B.D", "FAILED"],
      ["A.B.E", "SKIPPED"],
    ]);
  });
  it("refuses other files in plain words", () => {
    expect(() => parseResultsFile("<html></html>", "page.html")).toThrow(/isn't JUnit or NUnit/);
  });
  it("merges several files from one build", () => {
    const m = mergeFiles([
      { name: "a.xml", text: junit },
      { name: "b.xml", text: nunit3 },
    ]);
    expect(m.tests).toHaveLength(7);
    expect(m.build).toBe("4812");
  });
});

describe("keysInName and titleFromTest", () => {
  it("finds case keys of known projects only", () => {
    expect(keysInName("Checkout.CartTests.ABC_12_AddItem", ["ABC"])).toEqual(["ABC-12"]);
    expect(keysInName("XYZ-3 opens", ["ABC"])).toEqual([]);
  });
  it("makes readable titles", () => {
    expect(titleFromTest("ABC_12_AddItemToCart")).toBe("Add item to cart");
    expect(titleFromTest("LoadBelow10s")).toBe("Load below10s");
  });
});
