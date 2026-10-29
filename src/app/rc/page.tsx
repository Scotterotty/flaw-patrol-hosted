import { RcReport } from "@/components/rc-page";
import { TopBar } from "@/components/top-bar";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Release status" };

/** Old links land here: the last report you made, across every project you're in. Release status now lives in umbrellas and project Reports. */
export default async function RcStatusPage({ searchParams }: { searchParams: Promise<{ release?: string }> }) {
  const user = await requireUser();
  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Release status" subtitle="A quick look at how testing of a release is going on each platform." />
        <RcReport user={user} want={(await searchParams).release} base="/rc" />
      </main>
    </>
  );
}
