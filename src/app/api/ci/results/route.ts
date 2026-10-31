import { NextResponse } from "next/server";
import { expandUpload } from "@/lib/automation-media";
import { saveAutomationRun } from "@/lib/automation-save";
import { ciHash, CI_PREFIX } from "@/lib/ci-token";
import { ciRateLimited } from "@/lib/ci-rate-limit";
import { db } from "@/lib/db";
import { readForm } from "@/lib/zip-limits";
import { UserError } from "@/server/result";

// CI uploads (ver_91): a pipeline posts its JUnit or NUnit file with an umbrella's token.
//   curl -X POST $URL/api/ci/results -H "Authorization: Bearer $TOKEN" \
//     -F platform=Web -F build=$BUILD_ID -F file=@reports/junit.xml
// Results land like Upload automation results, in the newest open test cycle for that
// platform (or the one named with -F cycle=KEY), with same-title matches linked.
// Since ver_93 the file can be a zip of the results plus Playwright's test-results
// folder (-F file=@playwright-results.zip), bringing in screenshots, videos and replays.

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;
const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (!token.startsWith(CI_PREFIX)) return fail(401, "Send the token as: Authorization: Bearer fp_ci_…");
  const row = await db.ciToken.findUnique({ where: { hash: ciHash(token) }, include: { group: { select: { id: true, name: true, archivedAt: true, hubProjectId: true } } } });
  if (!row) return fail(401, "That token isn't valid. It may have been revoked.");
  if (await ciRateLimited(row.id)) return fail(429, "Too many uploads with this token. Wait a minute and try again.");
  if (row.group.archivedAt) return fail(409, `${row.group.name} is archived. Restore it to send results.`);
  // Counted while reading, so a missing or wrong Content-Length can't get past the cap.
  let form: FormData | null;
  try {
    form = await readForm(req, MAX_BYTES);
  } catch {
    return fail(400, "Send the results as multipart form data (curl -F).");
  }
  if (!form) return fail(413, "The upload is over 200 MB.");
  const text = (k: string) => String(form.get(k) ?? "").trim().slice(0, 200);
  const files = form.getAll("file").filter((f): f is File => typeof f === "object" && f !== null && "text" in f);
  if (!files.length) return fail(400, "Add the results file: -F file=@path/to/junit.xml");
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return fail(413, "The upload is over 200 MB.");

  const platform = text("platform");
  const cycleKey = text("cycle").toUpperCase();
  const cycles = await db.project.findMany({
    where: { groupId: row.groupId, archivedAt: null, id: { not: row.group.hubProjectId ?? "" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, key: true, name: true, groupId: true, platform: true },
  });
  const cycle = cycleKey
    ? cycles.find((c) => c.key === cycleKey)
    : platform
      ? cycles.find((c) => c.platform.toLowerCase() === platform.toLowerCase())
      : cycles.length === 1
        ? cycles[0]
        : undefined;
  if (!cycle) {
    if (cycleKey) return fail(404, `No open ${row.group.name} test cycle has the key ${cycleKey}.`);
    const names = [...new Set(cycles.map((c) => c.platform).filter(Boolean))];
    if (!platform) return fail(400, `Say which platform the results are for: -F platform=${names[0] ?? "Web"}${names.length ? ` (${names.join(", ")})` : ""}.`);
    return fail(404, `No open ${row.group.name} test cycle for ${platform}.${names.length ? ` Platforms: ${names.join(", ")}.` : ""}`);
  }

  try {
    let bundle;
    try {
      bundle = await expandUpload(await Promise.all(files.map(async (f) => ({ name: (f.name || "results.xml").slice(0, 300), bytes: new Uint8Array(await f.arrayBuffer()) }))));
    } catch (e) {
      return fail(400, e instanceof Error ? e.message : "That file couldn't be read.");
    }
    if (!bundle.results.length) return fail(400, "There's no results file in the upload. Send the .xml your tests write, or a zip with it inside.");
    const res = await saveAutomationRun(
      cycle,
      bundle.results,
      { build: text("build"), environment: text("environment"), name: text("name") },
      { id: row.createdById, name: `CI (${row.name})` },
      { linkSameTitle: true, media: bundle.media },
    );
    await db.ciToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    const url = new URL(`/p/${res.key}/runs/${res.number}`, req.url).toString();
    return NextResponse.json({ ok: true, cycle: res.key, run: res.number, url });
  } catch (e) {
    if (e instanceof UserError) return fail(/already in Flaw Patrol/.test(e.message) ? 409 : 400, e.message);
    console.error("CI upload failed", e);
    return fail(500, "The upload couldn't be saved. Try again, or upload the file by hand.");
  }
}
