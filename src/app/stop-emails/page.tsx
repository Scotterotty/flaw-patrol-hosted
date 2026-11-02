import { LogoBanner } from "@/components/logo";
import { StopEmailsButton } from "@/components/stop-emails";
import { Card } from "@/components/ui";
import { readStopToken } from "@/lib/digest-token";

export const metadata = { title: "Stop these emails" };

const WHAT = { run: "run summary emails", bash: "bug bash summary emails", rc: "release testing done emails" } as const;

/**
 * The Stop link in a digest email. No sign-in needed. It asks first, so a mail
 * program that opens links to check them doesn't stop the emails by itself.
 */
export default async function StopEmailsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const token = readStopToken(t);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm overflow-hidden p-6">
        <div className="-mx-6 -mt-6 mb-6 bg-[#191d24]">
          <LogoBanner />
        </div>
        {token ? (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">Stop {WHAT[token.kind]}?</h1>
            <p className="mb-4 text-sm text-slate-600">Flaw Patrol stops sending them to {token.email}. You can turn them back on any time in Your account → Emails I get.</p>
            <StopEmailsButton token={t} />
          </>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">This stop link doesn&apos;t work</h1>
            <p className="text-sm text-slate-600">Use the Stop link in the newest email, or change your emails in Your account → Emails I get.</p>
          </>
        )}
      </Card>
    </main>
  );
}
