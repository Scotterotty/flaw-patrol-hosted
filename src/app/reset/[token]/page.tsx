import Link from "next/link";
import { LogoBanner } from "@/components/logo";
import { ResetPasswordForm } from "@/components/reset-password";
import { Card } from "@/components/ui";
import { findPasswordLink } from "@/server/passwords";

export const metadata = { title: "Set your password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await findPasswordLink(token);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm overflow-hidden p-6">
        <div className="-mx-6 -mt-6 mb-6 bg-[#191d24]">
          <LogoBanner />
        </div>
        {link ? (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">Set a new password</h1>
            <p className="mb-4 text-sm text-slate-500">For {link.email}</p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">This link doesn&apos;t work anymore</h1>
            <p className="mb-4 text-sm text-slate-600">Password links work once and expire after a day. Ask an admin for a new one.</p>
            <Link href="/signin" className="text-sm text-accent-700 hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}
