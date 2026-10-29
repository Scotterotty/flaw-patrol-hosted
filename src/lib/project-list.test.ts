import { describe, expect, it } from "vitest";
import { arrange, arrangeUmbrellas, findRows, moveBefore, moveUmbrella, search, type FindRow, type ProjectItem, type UmbrellaItem } from "./project-list";

const p = (name: string, extra: Partial<ProjectItem> = {}): ProjectItem => ({
  id: name,
  key: name.replace(/[^A-Z]/g, "") || "X",
  name,
  description: "",
  starred: false,
  visitedAt: null,
  archivedAt: null,
  position: null,
  hidden: false,
  ...extra,
});

describe("projects page sections", () => {
  it("is one plain list when there are only a few projects", () => {
    const r = arrange([p("Web", { visitedAt: 5 }), p("App")]);
    expect(r.crowded).toBe(false);
    expect(r.recent).toEqual([]);
    expect(r.rest.map((x) => x.name)).toEqual(["App", "Web"]);
  });

  it("puts starred first, then the most recently opened, then the rest, and archived apart", () => {
    const items = [
      p("Alpha", { visitedAt: 1 }),
      p("Bravo", { starred: true, visitedAt: 99 }),
      p("Charlie", { visitedAt: 50 }),
      p("Delta", { visitedAt: 40 }),
      p("Echo", { visitedAt: 30 }),
      p("Foxtrot", { visitedAt: 20 }),
      p("Golf"),
      p("Old", { archivedAt: 1, starred: true, visitedAt: 100 }),
      p("Older", { archivedAt: 2 }),
    ];
    const r = arrange(items);
    expect(r.crowded).toBe(true);
    expect(r.starred.map((x) => x.name)).toEqual(["Bravo"]);
    expect(r.recent.map((x) => x.name)).toEqual(["Charlie", "Delta", "Echo"]);
    expect(r.rest.map((x) => x.name)).toEqual(["Alpha", "Foxtrot", "Golf"]);
    expect(r.archived.map((x) => x.name)).toEqual(["Older", "Old"]);
  });
});

describe("project search", () => {
  const items = [p("OKO Web", { key: "OW" }), p("OKO Web RC22", { key: "OWIT", description: "Let's give it a shot" }), p("OKO Unity", { key: "OU" }), p("Quest Test", { key: "QT", archivedAt: 1 })];
  it("matches every word in the name, key or description", () => {
    expect(search(items, "web").map((x) => x.key)).toEqual(["OW", "OWIT"]);
    expect(search(items, "oko rc22").map((x) => x.key)).toEqual(["OWIT"]);
    expect(search(items, "shot").map((x) => x.key)).toEqual(["OWIT"]);
    expect(search(items, "nothing")).toEqual([]);
  });
  it("ranks an exact key first and archived last", () => {
    expect(search(items, "ou")[0].key).toBe("OU");
    expect(search(items, "t").at(-1)!.key).toBe("QT");
  });

  it("follows the viewer's own order, then name, and keeps hidden projects apart", () => {
    const r = arrange([p("Alpha"), p("Bravo", { position: 1 }), p("Charlie", { position: 0 }), p("Delta", { hidden: true }), p("Echo", { hidden: true, archivedAt: 3 })]);
    expect(r.rest.map((x) => x.name)).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(r.hidden.map((x) => x.name)).toEqual(["Delta", "Echo"]);
    expect(r.archived).toEqual([]);
  });

  it("moves a project before another, or to the end", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(moveBefore(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });
  it("keeps grouped projects out of the main sections but not out of Archived", () => {
    const r = arrange([p("Web", { groupId: "oko" }), p("Old", { groupId: "oko", archivedAt: 3 }), p("Launcher"), p("OKO", { id: "g:oko" })]);
    expect(r.rest.map((x) => x.name)).toEqual(["Launcher", "OKO"]);
    expect(r.archived.map((x) => x.name)).toEqual(["Old"]);
  });
});

describe("umbrella order", () => {
  const u = (name: string, extra: Partial<UmbrellaItem> = {}): UmbrellaItem => ({ id: name, name, starred: false, position: null, activity: null, ...extra });
  const items = [u("Beacon", { position: 0, activity: 1 }), u("Atlas", { position: 1, activity: 5 }), u("Zephyr", { activity: 9 }), u("OKO", { starred: true, position: 3, activity: 2 })];
  const names = (list: UmbrellaItem[]) => list.map((x) => x.name);

  it("puts starred first, then the viewer's order, with unplaced ones at the bottom", () => {
    expect(names(arrangeUmbrellas(items, "mine"))).toEqual(["OKO", "Beacon", "Atlas", "Zephyr"]);
  });

  it("sorts by latest activity or by name, starred still first", () => {
    expect(names(arrangeUmbrellas(items, "recent"))).toEqual(["OKO", "Zephyr", "Atlas", "Beacon"]);
    expect(names(arrangeUmbrellas(items, "az"))).toEqual(["OKO", "Atlas", "Beacon", "Zephyr"]);
  });

  it("moves an umbrella only within its own star group", () => {
    const shown = arrangeUmbrellas(items, "mine");
    expect(moveUmbrella(shown, "Zephyr", "top")).toEqual(["OKO", "Zephyr", "Beacon", "Atlas"]);
    expect(moveUmbrella(shown, "Beacon", "down")).toEqual(["OKO", "Atlas", "Beacon", "Zephyr"]);
    expect(moveUmbrella(shown, "Atlas", "up")).toEqual(["OKO", "Atlas", "Beacon", "Zephyr"]);
    expect(moveUmbrella(shown, "Beacon", { before: null })).toEqual(["OKO", "Atlas", "Zephyr", "Beacon"]);
    expect(moveUmbrella(shown, "OKO", "bottom")).toEqual(["OKO", "Beacon", "Atlas", "Zephyr"]);
  });
});

describe("umbrellas page search", () => {
  const rows: FindRow[] = [
    { id: "u1", kind: "umbrella", name: "OKO", key: "", where: "Umbrella", href: "/g/u1", archived: false },
    { id: "c1", kind: "cycle", name: "OKO Web RC22", key: "OW22", where: "in OKO", href: "/p/OW22", archived: true },
    { id: "c2", kind: "cycle", name: "Atlas Web RC22", key: "AW22", where: "in Atlas", href: "/p/AW22", archived: false },
    { id: "l1", kind: "loose", name: "Billing QA", key: "BIL", where: "Not in an umbrella", href: "/p/BIL", archived: false },
  ];
  it("finds archived and live rows by name, key or umbrella, live first", () => {
    expect(findRows(rows, "rc22", "all").map((r) => r.id)).toEqual(["c2", "c1"]);
    expect(findRows(rows, "oko", "all").map((r) => r.id)).toEqual(["u1", "c1"]);
    expect(findRows(rows, "bil", "all").map((r) => r.id)).toEqual(["l1"]);
  });
  it("keeps to the chosen scope", () => {
    expect(findRows(rows, "rc22", "archived").map((r) => r.id)).toEqual(["c1"]);
    expect(findRows(rows, "rc22", "active").map((r) => r.id)).toEqual(["c2"]);
  });
});
