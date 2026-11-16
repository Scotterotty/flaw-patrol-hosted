import { describe, expect, it } from "vitest";
import { withoutDoctype } from "./automation";

describe("withoutDoctype (review: XML entities)", () => {
  it("takes out a DOCTYPE with entity definitions, so they can't expand", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><testsuite name="&lol2;"/>`;
    const out = withoutDoctype(bomb);
    expect(out).not.toMatch(/DOCTYPE|ENTITY/);
    expect(out).toContain(`<testsuite name="&lol2;"/>`);
  });
  it("leaves ordinary reports alone", () => {
    const xml = `<?xml version="1.0"?><testsuite><testcase name="a &amp; b"/></testsuite>`;
    expect(withoutDoctype(xml)).toBe(xml);
  });
});
