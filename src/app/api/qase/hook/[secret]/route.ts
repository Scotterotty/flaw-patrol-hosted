import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sharingCycles, syncCycle } from "@/lib/qase-sync";

// Qase webhooks (ver_164): Qase calls this link when a result is saved or a run changes.
// The secret in the link says which umbrella it is; what Qase sends isn't trusted, it only
// starts a sync that reads the results from Qase's API with the saved token.

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(secret)) return NextResponse.json({ ok: false }, { status: 404 });
  const cfg = await db.qaseConfig.findUnique({ where: { hookSecret: secret }, select: { groupId: true, bring: true, group: { select: { archivedAt: true } } } });
  if (!cfg) return NextResponse.json({ ok: false }, { status: 404 });
  if (cfg.bring && !cfg.group.archivedAt) {
    after(async () => {
      for (const c of await sharingCycles(cfg.groupId)) {
        const p = await db.project.findUnique({ where: { id: c.id }, select: { qaseRunId: true } });
        if (p?.qaseRunId) await syncCycle(c.id, { send: false }).catch(() => {});
      }
    });
  }
  return NextResponse.json({ ok: true });
}
