// CI's vulnerability check: `npm audit` on the packages that ship (not dev tools),
// failing on any high or critical advisory that isn't on security/audit-allowlist.json.
// Allow-list entries past their review date fail too, so nothing stays accepted forever.
// Usage: node scripts/audit-check.mjs   (npm run audit:check)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FAIL_AT = new Set(["high", "critical"]);
const today = new Date().toISOString().slice(0, 10);

const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error("npm audit didn't return a report (is the registry reachable?).\n" + (r.stderr || r.stdout));
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

const allow = JSON.parse(readFileSync(new URL("../security/audit-allowlist.json", import.meta.url), "utf8")).advisories;
const allowed = new Map(allow.map((a) => [a.id, a]));

// Each advisory once, with every installed package it reaches through.
const found = new Map();
for (const [pkg, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== "object" || !FAIL_AT.has(via.severity)) continue;
    const id = via.url?.split("/").pop() ?? `${via.name}@${via.range}`;
    const a = found.get(id) ?? { id, name: via.name, severity: via.severity, title: via.title, url: via.url, range: via.range, through: new Set() };
    a.through.add(pkg);
    found.set(id, a);
  }
}

const fresh = [...found.values()].filter((a) => !allowed.has(a.id));
const expired = allow.filter((a) => found.has(a.id) && a.review < today);
const gone = allow.filter((a) => !found.has(a.id));

for (const a of found.values())
  if (allowed.has(a.id) && !expired.includes(allowed.get(a.id))) console.log(`accepted  ${a.severity.padEnd(8)} ${a.name} ${a.id} (review by ${allowed.get(a.id).review})`);
for (const a of gone) console.log(`note      ${a.id} (${a.package}) is no longer reported; remove it from security/audit-allowlist.json.`);
for (const a of expired) console.log(`EXPIRED   ${a.id} (${a.package}): review date ${a.review} has passed. Fix it, or renew the date with a reason.`);
for (const a of fresh) console.log(`NEW       ${a.severity.padEnd(8)} ${a.name} ${a.range} ${a.title}\n          ${a.url}\n          via ${[...a.through].join(", ")}`);

const m = report.metadata?.vulnerabilities ?? {};
console.log(`\nnpm audit (shipped packages): ${m.critical ?? 0} critical, ${m.high ?? 0} high, ${m.moderate ?? 0} moderate, ${m.low ?? 0} low.`);
if (fresh.length || expired.length) {
  console.error(`Failing: ${fresh.length} new and ${expired.length} expired high/critical advisories. Update the package (npm audit fix), or add it to security/audit-allowlist.json with a reason and a review date.`);
  process.exit(1);
}
console.log("No new high or critical advisories.");
