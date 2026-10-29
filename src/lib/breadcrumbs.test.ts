import { describe, expect, it } from "vitest";
import { crumbsFor } from "./breadcrumbs";

const oko = { key: "OKO", name: "OKO Web" };
const labels = (path: string, project?: typeof oko) => crumbsFor(path, project).map((c) => c.label);

describe("crumbsFor", () => {
  it("starts every trail at Umbrellas", () => {
    expect(labels("/")).toEqual(["Umbrellas"]);
    expect(labels("/account")).toEqual(["Umbrellas", "Your account"]);
    expect(crumbsFor("/p/OKO/cases", oko)[0]).toEqual({ label: "Umbrellas", href: "/" });
  });

  it("names the project and section", () => {
    expect(labels("/p/OKO/cases", oko)).toEqual(["Umbrellas", "OKO Web", "Test cases"]);
    expect(labels("/p/OKO/shared-steps", oko)).toEqual(["Umbrellas", "OKO Web", "Shared steps"]);
  });

  it("goes deeper for cases and runs", () => {
    expect(labels("/p/OKO/cases/12/edit", oko)).toEqual(["Umbrellas", "OKO Web", "Test cases", "OKO-12", "Edit"]);
    expect(labels("/p/OKO/cases/12/versions/3", oko)).toEqual(["Umbrellas", "OKO Web", "Test cases", "OKO-12", "Version 3"]);
    expect(labels("/p/OKO/runs/22/execute", oko)).toEqual(["Umbrellas", "OKO Web", "Test runs", "R22", "Execute"]);
    expect(labels("/p/OKO/suites/new", oko)).toEqual(["Umbrellas", "OKO Web", "Test suites", "New"]);
  });

  it("uses the name a page gives itself", () => {
    const names = { "/p/OKO/runs/22": "Smoke", "/p/OKO/suites/abc": "Checkout regression" };
    expect(crumbsFor("/p/OKO/runs/22/execute", oko, names).map((c) => c.label)).toEqual(["Umbrellas", "OKO Web", "Test runs", "R22 Smoke", "Execute"]);
    expect(crumbsFor("/p/OKO/suites/abc/edit", oko, names).map((c) => c.label)).toEqual(["Umbrellas", "OKO Web", "Test suites", "Checkout regression", "Edit"]);
    expect(labels("/p/OKO/suites/abc", oko)).toEqual(["Umbrellas", "OKO Web", "Test suites", "Details"]);
  });
  it("shows a project's group between Umbrellas and the project, and names a group page", () => {
    const crumbs = crumbsFor("/p/WEB/cases", { key: "WEB", name: "OKO Web", group: { id: "g1", name: "OKO" } });
    expect(crumbs.map((c) => c.label)).toEqual(["Umbrellas", "OKO", "OKO Web", "Test cases"]);
    expect(crumbs[1].href).toBe("/g/g1");
    expect(crumbsFor("/g/g1", undefined, { "/g/g1": "OKO" }).map((c) => c.label)).toEqual(["Umbrellas", "OKO"]);
  });
});
