import Link from "next/link";
import { LastPlaceMenu } from "@/components/last-place-menu";
import { TopBar } from "@/components/top-bar";
import { currentUser } from "@/lib/session";

/** Keeps the top bar and the left menu, so nobody is stranded on a blank page (ver_201). */
export default async function NotFound() {
  const user = await currentUser().catch(() => null);
  const body = (
    <main id="main" tabIndex={-1} className="flex min-h-[60vh] min-w-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-slate-500">It doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="text-sm text-accent-700 hover:underline">
        Go to my home page
      </Link>
    </main>
  );
  if (!user) return body;
  return (
    <>
      <TopBar user={user} />
      <div className="flex">
        <LastPlaceMenu user={user} />
        {body}
      </div>
    </>
  );
}
