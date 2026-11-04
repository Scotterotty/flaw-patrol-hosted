// Stand-in for Qase's API v1 (ver_164), used by ver164.spec.ts. Answers like Qase does
// (the { status, result } envelope, limit/offset pages) for one project, OKO.
// Test hooks: POST /__reset, GET /__state, POST /__result (a result "saved in Qase").
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_QASE_PORT ?? 3192);
const TOKEN = "qase_good";

const fresh = () => ({
  projects: [
    { code: "OKO", title: "OKO" },
    { code: "WEB", title: "Web store" },
  ],
  cases: [
    { id: 12, title: "Sign in with Google" },
    { id: 13, title: "Sign in with Microsoft" },
    { id: 51, title: "Crop the profile picture" },
    { id: 88, title: "Pay with a saved card" },
    { id: 90, title: "Pay with a new card" },
    { id: 102, title: "Show the offline message" },
  ],
  runs: [{ id: 7, title: "Nightly regression", status_text: "active", cases: [] }],
  results: [],
  nextRun: 20,
  nextHash: 1,
});
let state = fresh();

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const ok = (res, result) => send(res, 200, { status: true, result });
const page = (url, rows) => {
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const entities = rows.slice(offset, offset + limit);
  return { total: rows.length, filtered: rows.length, count: entities.length, entities };
};
const body = (req) =>
  new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s ? JSON.parse(s) : {}));
  });
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/v1/, "");
  if (path === "/__reset") {
    state = fresh();
    return send(res, 200, { ok: true });
  }
  if (path === "/__state") return send(res, 200, state);
  if (path === "/__result") {
    const b = await body(req);
    const r = { hash: `q${state.nextHash++}`, run_id: b.run_id, case_id: b.case_id, status: b.status, comment: b.comment ?? "", end_time: b.end_time ?? now() };
    state.results.push(r);
    return send(res, 200, r);
  }
  if (req.headers.token !== TOKEN) return send(res, 401, { status: false, errorMessage: "Unauthorized" });
  let m;
  if (path === "/project") return ok(res, page(url, state.projects));
  if ((m = /^\/project\/(\w+)$/.exec(path))) {
    const p = state.projects.find((x) => x.code === m[1]);
    return p ? ok(res, p) : send(res, 404, { status: false, errorMessage: "Project not found" });
  }
  if ((m = /^\/case\/(\w+)$/.exec(path))) return ok(res, page(url, m[1] === "OKO" ? state.cases : []));
  if ((m = /^\/run\/(\w+)$/.exec(path))) {
    if (req.method === "POST") {
      const b = await body(req);
      const run = { id: state.nextRun++, title: b.title, status_text: "active", cases: b.cases ?? [] };
      state.runs.push(run);
      return ok(res, { id: run.id });
    }
    return ok(res, page(url, state.runs));
  }
  if ((m = /^\/run\/(\w+)\/(\d+)$/.exec(path))) {
    const run = state.runs.find((r) => r.id === Number(m[2]));
    return run ? ok(res, run) : send(res, 404, { status: false, errorMessage: "Run not found" });
  }
  if ((m = /^\/result\/(\w+)\/(\d+)$/.exec(path)) && req.method === "POST") {
    const b = await body(req);
    const r = { hash: `h${state.nextHash++}`, run_id: Number(m[2]), case_id: b.case_id, status: b.status, comment: b.comment ?? "", end_time: now() };
    state.results.push(r);
    return ok(res, { case_id: r.case_id, hash: r.hash });
  }
  if ((m = /^\/result\/(\w+)$/.exec(path))) {
    const run = Number(url.searchParams.get("run"));
    return ok(res, page(url, state.results.filter((r) => !run || r.run_id === run)));
  }
  send(res, 404, { status: false, errorMessage: "Not found" });
}).listen(PORT, () => console.log(`mock Qase on ${PORT}`));
