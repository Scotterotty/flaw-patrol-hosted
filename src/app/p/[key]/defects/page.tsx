import { redirect } from "next/navigation";

/** The Defects page is called Bugs now; old links still land there. */
export default async function OldDefectsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string>> }) {
  const query = new URLSearchParams(await searchParams).toString();
  redirect(`/p/${(await params).key}/bugs${query ? `?${query}` : ""}`);
}
