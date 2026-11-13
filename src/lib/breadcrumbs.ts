import { caseKey } from "./format";

const SECTIONS: Record<string, string> = {
  cases: "Test cases",
  suites: "Test suites",
  runs: "Test runs",
  defects: "Bugs",
  bugs: "Bugs",
  reports: "Reports",
  "shared-steps": "Shared steps",
  import: "Import",
  settings: "Test cycle settings",
  quests: "Quest map",
};

const GROUP_SECTIONS: Record<string, string> = { runs: "Test runs", bugs: "Bugs", settings: "Settings", projects: "Test cycles", reports: "Reports", shortcuts: "Shortcuts", rc: "Release status" };

export type Crumb = { label: string; href?: string };

/** Where you are, next to the logo: Umbrellas › OKO › OKO Web RC23 › Test cases › … Every crumb but the last is a link. */
export function crumbsFor(path: string, project?: { key: string; name: string; group?: { id: string; name: string } | null; hub?: string }, names: Record<string, string> = {}): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Umbrellas", href: "/" }];
  if (path === "/rc") return [...crumbs, { label: "Release status" }];
  if (path.startsWith("/g/")) {
    const [id, sub] = path.split("?")[0].slice(3).split("/");
    const name = names[`/g/${id}`] ?? project?.name ?? "Group";
    if (!sub || !GROUP_SECTIONS[sub]) return [...crumbs, { label: name }];
    return [...crumbs, { label: name, href: `/g/${id}` }, { label: GROUP_SECTIONS[sub] }];
  }
  if (path.startsWith("/account")) return [...crumbs, { label: "Your account" }];
  if (path.startsWith("/leaderboard")) return [...crumbs, { label: "Your account", href: "/account" }, { label: "Bug of War" }];
  if (!project) return crumbs;

  const base = `/p/${project.key}`;
  if (project.group) crumbs.push({ label: project.group.name, href: `/g/${project.group.id}` });
  // An umbrella's hub pages read as the umbrella's: Umbrellas › OKO › Case library.
  crumbs.push({ label: project.name, href: project.hub ? `/g/${project.hub}` : base });
  const [section, id, sub, subId] = path.slice(base.length).split("/").filter(Boolean);
  if (!section || !SECTIONS[section]) return crumbs;
  crumbs.push({ label: project.hub && section === "cases" ? "Case library" : SECTIONS[section], href: `${base}/${section}` });
  if (!id) return crumbs;

  // A page can name itself (a suite's or run's name) so the crumb isn't just an id.
  const href = `${base}/${section}/${id}`;
  const name = names[href];
  if (id === "new") crumbs.push({ label: "New" });
  // Not a run number: Test runs › Import a run, never "Rimport" (ver_54 audit #5).
  else if (section === "runs" && id === "import") crumbs.push({ label: "Import a run" });
  else if (section === "cases" && id === "sisters") crumbs.push({ label: "Sister cases" });
  else if (section === "cases") crumbs.push({ label: caseKey(project.key, Number(id)), href });
  else if (section === "runs" || section === "quests") crumbs.push({ label: name ?? (section === "runs" ? "Run" : "Quest"), href });
  else crumbs.push({ label: name ?? "Details", href });

  if (sub === "edit") crumbs.push({ label: "Edit" });
  else if (sub === "execute") crumbs.push({ label: "Execute" });
  else if (sub === "versions" && subId) crumbs.push({ label: `Version ${subId}` });
  return crumbs;
}
