// Stand-in for GitHub's API (ver_85), used by github.spec.ts. It answers with
// responses recorded from Scott's demo repo Scotterotty/flaw-patrol-ci-demo, and
// serves each run's artifact as a zip holding the repo's junit.xml.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import JSZip from "jszip";

const DIR = join(import.meta.dirname, "fixtures", "github");
const read = (f) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const REPO = "Scotterotty/flaw-patrol-ci-demo";
const TOKEN = "github_pat_good";
const PORT = Number(process.env.MOCK_GITHUB_PORT ?? 3196);
const junit = readFileSync(join(DIR, "junit.xml"), "utf8");
const runs = read("runs.json");

// Artifact id → zip bytes, with the build number the demo workflow writes.
const zips = new Map();
for (const r of runs.workflow_runs) {
  const { artifacts } = read(`artifacts-${r.id}.json`);
  for (const a of artifacts) {
    const zip = new JSZip();
    zip.file("junit.xml", junit.replaceAll("{{BUILD}}", String(r.run_number)));
    zips.set(String(a.id), await zip.generateAsync({ type: "nodebuffer" }));
  }
}

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  // The storage host GitHub redirects downloads to: no token there.
  const blob = /^\/__blob\/(\d+)\.zip$/.exec(path);
  if (blob) {
    const z = zips.get(blob[1]);
    if (!z) return send(res, 404, { message: "Not Found" });
    res.writeHead(200, { "content-type": "application/zip" });
    return res.end(z);
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: "Bad credentials" });
  const base = `/repos/${REPO}`;
  if (!path.toLowerCase().startsWith(base.toLowerCase())) return send(res, 404, { message: "Not Found" });
  const rest = path.slice(base.length);
  if (rest === "") return send(res, 200, read("repo.json"));
  if (rest === "/actions/workflows") return send(res, 200, read("workflows.json"));
  // Pull requests (ver_96): bug bash area links.
  if (rest === "/pulls")
    return send(res, 200, [
      { number: 418, title: "Lazy-load space thumbnails", state: "open", merged_at: null, html_url: `https://github.com/${REPO}/pull/418`, user: { login: "dana" } },
      { number: 412, title: "Invite links expire after 7 days", state: "closed", merged_at: "2026-10-28T10:00:00Z", html_url: `https://github.com/${REPO}/pull/412`, user: { login: "sam" } },
    ]);
  let m = /^\/actions\/workflows\/(\d+)\/runs$/.exec(rest);
  if (m) return send(res, 200, runs);
  m = /^\/actions\/runs\/(\d+)$/.exec(rest);
  if (m) {
    const r = runs.workflow_runs.find((x) => String(x.id) === m[1]);
    return r ? send(res, 200, r) : send(res, 404, { message: "Not Found" });
  }
  m = /^\/actions\/runs\/(\d+)\/artifacts$/.exec(rest);
  if (m) {
    try {
      return send(res, 200, read(`artifacts-${m[1]}.json`));
    } catch {
      return send(res, 200, { artifacts: [] });
    }
  }
  // Build steps (ver_89): each run's job and its steps, and the failed job's annotations.
  m = /^\/actions\/runs\/(\d+)\/jobs$/.exec(rest);
  if (m) {
    try {
      return send(res, 200, read(`jobs-${m[1]}.json`));
    } catch {
      return send(res, 200, { total_count: 0, jobs: [] });
    }
  }
  m = /^\/check-runs\/(\d+)\/annotations$/.exec(rest);
  if (m) {
    try {
      return send(res, 200, read(`annotations-${m[1]}.json`));
    } catch {
      return send(res, 200, []);
    }
  }
  m = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(rest);
  if (m) {
    res.writeHead(302, { location: `http://localhost:${PORT}/__blob/${m[1]}.zip` });
    return res.end();
  }
  send(res, 404, { message: "Not Found" });
}).listen(PORT, () => console.log(`mock GitHub on ${PORT}`));
