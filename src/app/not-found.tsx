import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-slate-500">It doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="text-sm text-accent-700 hover:underline">
        Back to umbrellas
      </Link>
    </main>
  );
}
