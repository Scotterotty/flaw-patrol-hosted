import { attachedWrapUps, rcWrapKey, releaseStart, reportsWrapKey, wrapPickOf } from "@/lib/wrap-ups";
import type { ReportFilters } from "@/lib/reports";
import { NextResponse, type NextRequest } from "next/server";
import { exportResponse } from "@/lib/report-export-route";
import { parseFilters } from "@/lib/reports";
import { projectAccess } from "@/lib/session";
import { newestRcNames } from "@/lib/story-coverage";
import { libraryProjectIds } from "@/lib/umbrella";
import { dateRange } from "@/lib/spelling";

/** A test cycle's Reports → Export: this tab as CSV or JSON, or the whole report as Excel or PDF. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { project, user } = await projectAccess(key);
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseFilters(sp);
  const when = f.runNumber ? `Run R${f.runNumber}` : f.release ? `Release ${f.release}` : f.allTime ? "All time" : dateRange(f.from, f.to, "us");
  const res = await exportResponse(
    {
      scope: project.id,
      homeId: project.id,
      umbrella: false,
      title: project.name,
      filters: [`Test cycle: ${project.name}`, `When: ${when}`, ...(f.kind ? [`Runs: ${f.kind}`] : [])],
      viewer: { id: user.id, isAdmin: user.isAdmin },
      coverage: { libraryIds: await libraryProjectIds(project), columns: [{ id: project.id, key: project.key, name: project.name }], rcNames: await newestRcNames([project]) },
      projectKey: project.key,
      query: sp,
      // Attached wrap-ups: Release status's for its release, else the Run reports'.
      wrapUps: await exportWrapUps(user.rcReport, [project.id], sp.view === "rc" && f.release ? rcWrapKey(`/p/${project.key}/reports/rc`, f.release) : reportsWrapKey(`/p/${project.key}/reports`), f),
    },
    f,
    sp,
    { fileBase: project.key, preparedBy: user.name ?? user.email },
  );
  return res ?? NextResponse.json({ error: "Unknown export." }, { status: 400 });
}

async function exportWrapUps(prefs: unknown, projectIds: string[], key: string, f: ReportFilters) {
  const pick = wrapPickOf(prefs, key);
  return attachedWrapUps(projectIds, pick, pick.auto ? (f.release ? await releaseStart(projectIds, f.release) : f.from) : null);
}
