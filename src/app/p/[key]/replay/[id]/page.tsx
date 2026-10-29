import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplayFrame } from "@/components/replay-frame";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "Step-by-step replay" };

/**
 * A Playwright replay (trace), opened inside Flaw Patrol (ver_93) with Playwright's own
 * viewer, shipped in public/trace-viewer. The file never leaves this server.
 */
export default async function ReplayPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { project } = await projectAccess(key);
  const file = await db.attachment.findFirst({
    where: { id, projectId: project.id, kind: "trace" },
    select: { id: true, fileName: true, size: true, result: { select: { run: { select: { number: true, name: true } }, entry: { select: { title: true, testCase: { select: { number: true, project: { select: { key: true } } } } } } } } },
  });
  if (!file?.result) notFound();
  const { run, entry } = file.result;
  const runHref = `/p/${project.key}/runs/${run.number}`;
  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <h1 className="font-semibold text-slate-900">
          Replay · <span className="font-mono text-xs text-slate-500">{caseKey(entry.testCase.project.key, entry.testCase.number)}</span> {entry.title} · R{run.number}
        </h1>
        <Link href={runHref} className="text-accent-700 hover:underline">
          Back to the run
        </Link>
        <a href={`/api/attachments/${file.id}`} download={file.fileName} className="text-accent-700 hover:underline">
          Download replay file
        </a>
        <span className="text-xs text-slate-500">Left: every action. Right: the page before and after it, plus the error, console and network calls.</span>
      </div>
      <ReplayFrame fileId={file.id} />
    </div>
  );
}
