import Link from "next/link";
import { passwordSignInOn, signIn } from "@/auth";
import { LogoBanner } from "@/components/logo";
import { AcceptInviteForm } from "@/components/accept-invite";
import { Button, Card } from "@/components/ui";
import { signInButtons } from "@/lib/sign-in-config";
import { ssoOnly } from "@/lib/sso-only";
import { findInviteLink } from "@/server/passwords";

export const metadata = { title: "Accept invite" };

/** Where an invite email's Accept invite button lands: a company sign-in button, or choose a password. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findInviteLink(token);
  const buttons = invite ? await signInButtons() : [];
  // Company sign-in only (hosted): the invite just says which button to use.
  const password = invite && !ssoOnly() && (!buttons.length || (await passwordSignInOn()));
  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm overflow-hidden p-6">
        <div className="-mx-6 -mt-6 mb-6 bg-[#191d24]">
          <LogoBanner />
        </div>
        {invite ? (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">{invite.title}</h1>
            <p className="mb-4 text-sm text-slate-500">For {invite.email}</p>
            <div className="space-y-2">
              {buttons.map((p) => (
                <form
                  key={p.id}
                  action={async () => {
                    "use server";
                    await signIn(p.id, { redirectTo: invite.landing });
                  }}
                >
                  <Button type="submit" className="w-full">
                    Sign in with {p.name}
                  </Button>
                </form>
              ))}
            </div>
            {password &&
              (invite.hasPassword ? (
                <Link href={`/signin?email=${encodeURIComponent(invite.email)}`} className="mt-4 block text-sm text-accent-700 hover:underline">
                  Sign in with your password
                </Link>
              ) : (
                <div className={buttons.length ? "mt-4 border-t border-slate-200 pt-4" : ""}>
                  <AcceptInviteForm token={token} askName={!invite.hasName} />
                </div>
              ))}
          </>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">This invite doesn&apos;t work anymore</h1>
            <p className="mb-4 text-sm text-slate-600">Invite links work once and expire after 7 days. You can still try signing in with your email, or ask an admin for a new invite.</p>
            <Link href="/signin" className="text-sm text-accent-700 hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}
