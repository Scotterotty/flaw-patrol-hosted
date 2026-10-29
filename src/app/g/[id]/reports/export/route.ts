import { attachedWrapUps, rcWrapKey, releaseStart, reportsWrapKey, wrapPickOf } from "@/lib/wrap-ups";
import type { ReportFilters } from "@/lib/reports";
import { NextResponse, type NextRequest } from "next/server";
import { exportResponse } from "@/lib/report-export-route";
import { parseFilters } from "@/lib/reports";
import { requireUser } from "@/lib/session";
import { dateRange } from "@/lib/spelling";
import { newestRcNames } from "@/lib/story-coverage";
import { loadUmbrella } from "@/lib/umbrella";

/** An umbrella's Reports → Export (ver_91): same as a test cycle's, across its test cycles, by platform. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  // Run numbers repeat between test cycles, so there is no run filter here.
  const f = parseFilters({ ...sp, run: undefined });
  const platform = sp.platform?.toLowerCase() || "";
  const all = [u.hub.id, ...u.projects.map((p) => p.id)];
  const scope = platform ? u.projects.filter((p) => p.platform.toLowerCase() === platform).map((p) => p.id) : all;
  const platformName = platform ? (u.platforms.find((p) => p.name.toLowerCase() === platform)?.name ?? sp.platform) : "All platforms";
  const when = f.release ? `Release ${f.release}` : f.allTime ? "All time" : dateRange(f.from, f.to, "us");
  const res = await exportResponse(
    {
      scope: scope.length ? scope : ["-"],
      homeId: u.hub.id,
      umbrella: true,
      title: u.group.name,
      filters: [`Umbrella: ${u.group.name}`, `Platform: ${platformName}`, `When: ${when}`, ...(f.kind ? [`Runs: ${f.kind}`] : [])],
      viewer: { id: user.id, isAdmin: user.isAdmin },
      coverage: { libraryIds: [u.hub.id], columns: u.current.map((p) => ({ id: p.id, key: p.key, name: p.name })), rcNames: await newestRcNames(u.current) },
      query: sp,
      // Attached wrap-ups (ver_96): Release status's for its release, else the Run reports'.
      wrapUps: await exportWrapUps(user.rcReport, all, sp.view === "rc" && f.release ? rcWrapKey(`/g/${u.group.id}/rc`, f.release) : reportsWrapKey(`/g/${u.group.id}/reports`), f),
    },
    f,
    sp,
    { fileBase: u.hub.key, preparedBy: user.name ?? user.email },
  );
  return res ?? NextResponse.json({ error: "Unknown export." }, { status: 400 });
}

async function exportWrapUps(prefs: unknown, projectIds: string[], key: string, f: ReportFilters) {
  const pick = wrapPickOf(prefs, key);
  return attachedWrapUps(projectIds, pick, pick.auto ? (f.release ? await releaseStart(projectIds, f.release) : f.from) : null);
}
