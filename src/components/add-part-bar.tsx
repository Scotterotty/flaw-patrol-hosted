import type { ReactNode } from "react";
import { AddToReport, AddToReportProvider } from "@/components/report-part-title";
import { addTargets } from "@/lib/custom-report-scope";
import type { Who } from "@/lib/permissions";
import type { PartId } from "@/lib/report-parts";

type Viewer = { id: string; isAdmin: boolean; name?: string | null; email: string };

/** Lets the boxes inside offer + Add to report, when this person can make reports. */
export async function AddPartsHere({ homeId, user, who, base, children }: { homeId: string; user: Viewer; who: Who; base: string; children: ReactNode }) {
  const reports = await addTargets(homeId, user, who);
  if (!reports) return <>{children}</>;
  return (
    <AddToReportProvider projectId={homeId} reports={reports} base={base}>
      {children}
    </AddToReportProvider>
  );
}

/** One + Add to report button for a whole tab (Release status, Requirements). */
export function AddPartBar({ part, title, ...rest }: { homeId: string; user: Viewer; who: Who; base: string; part: PartId; title: string }) {
  return (
    <AddPartsHere {...rest}>
      <div className="-mt-2 mb-2 flex justify-end">
        <AddToReport part={part} title={title} />
      </div>
    </AddPartsHere>
  );
}
