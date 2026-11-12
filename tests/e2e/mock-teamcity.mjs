// Stand-in for a TeamCity server's REST API (ver_228), used by status.spec.ts.
// Read-only like the real thing is to Flaw Patrol: it only answers GETs.
// Nightly Windows fails (and its text names who triggered it, which Flaw Patrol must hide);
// Android build passes.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_TEAMCITY_PORT ?? 3191);
const TOKEN = "tc_good";
const BASE = `http://localhost:${PORT}`;

const TYPES = [
  { id: "Shop_NightlyWindows", name: "Nightly Windows", projectName: "Shop" },
  { id: "Shop_Android", name: "Android build", projectName: "Shop" },
  { id: "Shop_Docs", name: "Docs", projectName: "Shop" },
];
const day = (n, h) => `202611${String(12 - n).padStart(2, "0")}T${String(h).padStart(2, "0")}0200+0000`;
const BUILDS = {
  Shop_NightlyWindows: [
    { id: 812, number: "812", status: "FAILURE", statusText: "Tests failed: 14 (2 new), passed: 310 (triggered by Pat Lee)", finishDate: day(0, 11) },
    { id: 811, number: "811", status: "FAILURE", statusText: "Tests failed: 3, passed: 321", finishDate: day(1, 11) },
    { id: 810, number: "810", status: "SUCCESS", statusText: "Tests passed: 324", finishDate: day(2, 11) },
    { id: 809, number: "809", status: "SUCCESS", statusText: "Tests passed: 324", finishDate: day(3, 11) },
    { id: 808, number: "808", status: "SUCCESS", statusText: "Tests passed: 324", finishDate: day(4, 11) },
  ],
  Shop_Android: [{ id: 95, number: "95", status: "SUCCESS", statusText: "Success", finishDate: day(0, 9) }],
  Shop_Docs: [],
};

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  if (req.method !== "GET") return send(res, 405, { message: "Read-only" });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: "Authentication required" });
  if (url.pathname === "/app/rest/server") return send(res, 200, { version: "2025.03 (build 186049)" });
  if (url.pathname === "/app/rest/buildTypes") return send(res, 200, { count: TYPES.length, buildType: TYPES });
  if (url.pathname === "/app/rest/builds") {
    const locator = url.searchParams.get("locator") ?? "";
    const id = /buildType:\(id:([A-Za-z0-9_]+)\)/.exec(locator)?.[1] ?? "";
    if (!(id in BUILDS)) return send(res, 404, { message: `No build type ${id}` });
    const count = Number(/count:(\d+)/.exec(locator)?.[1] ?? 100);
    const build = BUILDS[id].slice(0, count).map((b) => ({ ...b, state: "finished", branchName: "main", webUrl: `${BASE}/buildConfiguration/${id}/${b.id}` }));
    return send(res, 200, { count: build.length, build });
  }
  send(res, 404, { message: "Not found" });
}).listen(PORT, () => console.log(`mock TeamCity on ${BASE}`));
