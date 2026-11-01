import { PrismaClient, type ResultStatus } from "@prisma/client";

/**
 * ver_131: an umbrella with Unity and Web test cycles, 8 releases of manual runs, automated
 * uploads on the last 4, a flaky case and one that keeps failing, for How testing is going.
 * Results are spread over the past weeks so By week has data too. Returns the umbrella's id.
 */
export async function makeTrendsUmbrella(tag: string, opts: { releases?: number } = {}) {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    const members = { create: [{ userId: admin.id, role: "ADMIN" as const }, { userId: lead.id, role: "LEAD" as const }] };
    const hub = await db.project.create({ data: { key: `TR${tag}`, name: `Trends ${tag}`, members } });
    const group = await db.projectGroup.create({
      data: { name: `Trends ${tag}`, hubProjectId: hub.id, platforms: [{ name: "Unity", suiteIds: [] }, { name: "Web", suiteIds: [] }], rolesChosenAt: new Date() },
    });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const cases = [];
    for (let i = 1; i <= 6; i++)
      cases.push(await db.testCase.create({ data: { projectId: hub.id, number: i, title: ["Sign in", "Open a space", "Voice chat reconnects", "Upload a thumbnail", "Invite a friend", "Leave a space"][i - 1] } }));
    const releases = opts.releases ?? 8;
    const day = 86400_000;
    let runNo = 0;
    for (const platform of ["Unity", "Web"]) {
      const cycle = await db.project.create({ data: { key: `TR${platform[0]}${tag}`, name: `${platform} ${tag}`, platform, rcName: `RC ${releases}`, groupId: group.id, members } });
      for (let r = 1; r <= releases; r++) {
        // A release a week, the newest one this week.
        const at = new Date(Date.now() - (releases - r) * 7 * day - day);
        for (const automated of r > releases - 4 ? [false, true] : [false]) {
          runNo++;
          const run = await db.testRun.create({ data: { projectId: cycle.id, number: runNo, name: `RC ${r} ${automated ? "automation" : "smoke"}`, release: `RC ${r}`, automated, createdAt: at } });
          for (const [i, c] of cases.entries()) {
            // Case 3 flips every release; case 4 fails from the third-last release on; one early miss on case 1;
            // case 5 fails on Web every third release, so the platforms' lines differ.
            const status: ResultStatus = i === 2 ? (r % 2 ? "PASSED" : "FAILED") : i === 3 && r > releases - 3 ? "FAILED" : i === 0 && r === 2 && !automated ? "FAILED" : i === 4 && platform === "Web" && r % 3 === 0 ? "FAILED" : "PASSED";
            const entry = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM", steps: [], status } });
            const result = await db.testResult.create({
              data: { entryId: entry.id, runId: run.id, caseId: c.id, caseVersion: 1, status, stepResults: [], testerName: automated ? "" : "Demo Lead", automated, createdAt: new Date(at.getTime() + i * 60_000) },
            });
            if (status === "FAILED" && i === 3 && platform === "Web" && !automated) {
              const n = await db.defect.count({ where: { projectId: cycle.id } });
              const bug = await db.defect.create({ data: { projectId: cycle.id, number: n + 1, title: `Thumbnail upload fails ${r}`, severity: r === releases ? "CRITICAL" : "MINOR", createdAt: at } });
              await db.defectLink.create({ data: { defectId: bug.id, resultId: result.id } });
            }
          }
        }
      }
    }
    return group.id;
  } finally {
    await db.$disconnect();
  }
}
