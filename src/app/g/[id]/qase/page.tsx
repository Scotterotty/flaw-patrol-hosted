import Link from "next/link";
import { notFound } from "next/navigation";
import { QaseLinkRow } from "@/components/qase-link";
import { Card, PageHeader } from "@/components/ui";
import { NOT_BASH_CASE } from "@/lib/bash-cases";
import { open } from "@/lib/crypto";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { QaseClient, QaseError, type QaseCase } from "@/lib/qase";
import { closestCases, matchByTitle, qaseCaseKey } from "@/lib/qase-map";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";

export const metadata = { title: "Link cases to Qase" };

/**
 * Link cases (ver_164): which Qase case each case shares results with. Cases with the same
 * title link on their own when the page opens; the rest get a pick.
 */
export default async function QaseLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const g = `/g/${u.group.id}`;
  const cfg = await db.qaseConfig.findUnique({ where: { groupId: u.group.id } });
  if (!cfg)
    return (
      <div className="page page-settings">
        <PageHeader title="Link cases to Qase" />
        <Card className="p-4 text-sm text-slate-600">
          {u.group.name} isn&apos;t connected to Qase yet. <Link href={`${g}/settings#qase`} className="font-medium text-accent-700 hover:underline">Connect it in Settings → Qase</Link>.
        </Card>
      </div>
    );
  const canEdit = can(u.who, "case:edit") && !u.group.archivedAt;
  const inUmbrella = { project: { OR: [{ groupId: u.group.id }, { hubOf: { id: u.group.id } }] }, archived: false, ...NOT_BASH_CASE };
  let qaseCases: QaseCase[] = [];
  let error = "";
  try {
    qaseCases = await new QaseClient(open(cfg.tokenEncrypted)).cases(cfg.projectCode);
  } catch (e) {
    error = e instanceof QaseError ? e.message : "The saved Qase token can't be read here. Paste it again in Settings → Qase.";
  }
  // Same title on both sides: linked straight away.
  let autoLinked = 0;
  if (!error && canEdit) {
    const unlinked = await db.testCase.findMany({ where: { ...inUmbrella, qaseId: null }, select: { id: true, title: true } });
    if (unlinked.length) {
      const taken = new Set((await db.testCase.findMany({ where: { ...inUmbrella, qaseId: { gt: 0 } }, select: { qaseId: true } })).map((c) => c.qaseId!));
      for (const [id, qaseId] of matchByTitle(unlinked, qaseCases, taken)) {
        await db.testCase.update({ where: { id }, data: { qaseId } });
        autoLinked++;
      }
    }
  }
  const cases = await db.testCase.findMany({
    where: inUmbrella,
    orderBy: [{ project: { key: "asc" } }, { number: "asc" }],
    select: { id: true, number: true, title: true, qaseId: true, project: { select: { key: true } } },
  });
  const title = new Map(qaseCases.map((q) => [q.id, q.title]));
  const linked = cases.filter((c) => (c.qaseId ?? 0) > 0);
  const pick = cases.filter((c) => c.qaseId === null);
  const skipped = cases.filter((c) => c.qaseId === 0);
  const usedIds = new Set(linked.map((c) => c.qaseId!));
  const free = qaseCases.filter((q) => !usedIds.has(q.id));
  const row = (c: (typeof cases)[number], options: QaseCase[]) => (
    <QaseLinkRow
      key={c.id}
      groupId={u.group.id}
      caseId={c.id}
      caseKey={`${c.project.key}-${c.number}`}
      caseHref={`/p/${c.project.key}/cases/${c.number}`}
      title={c.title}
      code={cfg.projectCode}
      current={c.qaseId}
      currentTitle={c.qaseId ? (title.get(c.qaseId) ?? null) : null}
      options={options.map((q) => ({ id: q.id, label: `${qaseCaseKey(cfg.projectCode, q.id)} ${q.title}` }))}
      canEdit={canEdit}
    />
  );

  return (
    <div className="page page-settings">
      <PageHeader
        title="Link cases to Qase"
        subtitle={`${u.group.name} ↔ Qase project ${cfg.projectTitle} (${cfg.projectCode}). Only linked cases share results.`}
        actions={
          <Link href={`${g}/settings#qase`} className="text-sm font-medium text-accent-700 hover:underline">
            Settings → Qase
          </Link>
        }
      />
      {error && <p className="mb-4 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</p>}
      <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900" data-testid="qase-link-summary">
        <b>
          {linked.length} of {cases.length - skipped.length} linked
        </b>
        <span>{autoLinked ? `${autoLinked} just linked by title.` : "Cases with the same title link on their own."}</span>
        {skipped.length > 0 && <span className="text-emerald-800">{skipped.length} not shared on purpose.</span>}
      </p>

      <Card className="mb-5">
        <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Need a pick ({pick.length})</h2>
        {pick.length ? (
          <ul className="divide-y divide-slate-100" data-testid="qase-pick">
            {pick.map((c) => row(c, closestCases(c.title, free)))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-slate-500">Nothing to pick. Every case is linked or not shared on purpose.</p>
        )}
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">New cases link by title as they&apos;re added. You can change any link here later.</p>
      </Card>

      <details className="mb-5 rounded-lg border border-slate-200 bg-surface" data-testid="qase-linked">
        <summary className="cursor-pointer px-4 py-3 font-semibold text-slate-900">Linked ({linked.length})</summary>
        <ul className="divide-y divide-slate-100 border-t border-slate-100">{linked.map((c) => row(c, closestCases(c.title, free)))}</ul>
      </details>
      {skipped.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-surface" data-testid="qase-skipped">
          <summary className="cursor-pointer px-4 py-3 font-semibold text-slate-900">Not shared ({skipped.length})</summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">{skipped.map((c) => row(c, closestCases(c.title, free)))}</ul>
        </details>
      )}
    </div>
  );
}
