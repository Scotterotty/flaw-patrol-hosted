import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { mergeFiles } from "@/lib/automation";
import { countMedia, expandUpload, matchMedia } from "@/lib/automation-media";
import { stageMedia } from "@/lib/media-stage";
import { startUpload } from "@/lib/upload-gate";
import { readForm } from "@/lib/zip-limits";

// Upload automation results with pictures: the results file plus the
// test-results folder, or one zip of both. Results come back as text for the usual
// steps; screenshots, videos and replays wait on the server until Save.

export const dynamic = "force-dynamic";

const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail(401, "Sign in first.");
  // A few big uploads at a time, one per person, a limited number per hour (upload-gate.ts).
  const gate = startUpload(userId);
  if (!gate.ok) return fail(gate.status, gate.error);
  try {
    return await stage(req, userId);
  } finally {
    gate.done();
  }
}

async function stage(req: Request, userId: string) {
  // Counted while reading, so a missing or wrong Content-Length can't get past the cap.
  let form: FormData | null;
  try {
    form = await readForm(req, MAX_ZIP_BYTES);
  } catch {
    return fail(400, "Those files couldn't be read. Try again.");
  }
  if (!form) return fail(413, "That's over 200 MB. Upload the results file and fewer pictures at a time.");
  const files = form.getAll("file").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) return fail(400, "Drop a results file first.");
  const paths = form.getAll("path").map(String);
  try {
    const bundle = await expandUpload(await Promise.all(files.map(async (f, i) => ({ name: paths[i] || f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    if (!bundle.results.length)
      return fail(400, bundle.media.length ? "There's no results file in there, only pictures. Add the results.xml (or Playwright's JSON report) too." : "There's no results file in there. Upload the .xml file your tests write, or a zip with it inside.");
    const { tests, build } = mergeFiles(bundle.results);
    if (!tests.length) return fail(400, "That file has no test results in it.");
    const { unmatched } = matchMedia(tests, bundle.media);
    const stageId = await stageMedia(bundle.media, userId);
    return NextResponse.json({ ok: true, files: bundle.results, tests: tests.length, build, stageId, media: bundle.media.length ? { ...countMedia(bundle.media), unmatched } : null });
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "Those files couldn't be read.");
  }
}
