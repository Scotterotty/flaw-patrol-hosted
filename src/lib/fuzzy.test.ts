import { describe, expect, it } from "vitest";
import { closeWord, forgivingFilter, matchKind, tagHits } from "./fuzzy";

describe("closeWord", () => {
  it("lets letters be left out when the word starts the same", () => {
    expect(closeWord("wb", "web")).toBe(true);
    expect(closeWord("wb", "website")).toBe(true);
    expect(closeWord("wb", "showbox")).toBe(false);
  });
  it("forgives one slip in 4-7 letter words and two in longer ones", () => {
    expect(closeWord("loign", "login")).toBe(true);
    expect(closeWord("regresion", "regression")).toBe(true);
    expect(closeWord("regrsesino", "regression")).toBe(true);
    expect(closeWord("lgoin", "login")).toBe(true);
    expect(closeWord("cat", "cot")).toBe(false);
  });
  it("keeps numbers and single letters exact", () => {
    expect(closeWord("112", "113")).toBe(false);
    expect(closeWord("w", "web")).toBe(false);
  });
});

describe("matchKind", () => {
  it("finds exact text first", () => {
    expect(matchKind("web", "Web app login")).toBe("exact");
    expect(matchKind("[WEB]", "WEB Hub space list")).toBe("exact");
    expect(matchKind("login web", "Web app login")).toBe("exact");
  });
  it("finds close matches", () => {
    expect(matchKind("wb", "Log in on the web app")).toBe("close");
    expect(matchKind("loign", "Login keeps you signed in")).toBe("close");
    expect(matchKind("wb loign", "Web login")).toBe("close");
  });
  it("looks only at names for close matches", () => {
    expect(matchKind("wb", "Sign in. Step: open the web page", "Sign in")).toBeNull();
  });
  it("keeps keys exact", () => {
    expect(matchKind("APP-113", "APP-112 Sign in")).toBeNull();
  });
});

describe("forgivingFilter", () => {
  const list = ["Web app", "Webhook fires", "Website footer", "Sandbox", "Login"];
  it("puts close matches after exact ones", () => {
    expect(forgivingFilter(list, "wb", (x) => x)).toEqual({ exact: [], close: ["Web app", "Webhook fires", "Website footer"] });
  });
  it("leaves close matches out when there are plenty of exact ones", () => {
    const many = ["web 1", "web 2", "web 3", "web 4", "web 5", "wbe"];
    expect(forgivingFilter(many, "web", (x) => x).close).toEqual([]);
  });
});

it("outlines the tags a search matched", () => {
  expect(tagHits("[web]", ["WEB", "smoke"])).toEqual(["WEB"]);
  expect(tagHits("wb", ["WEB", "smoke"])).toEqual(["WEB"]);
});
