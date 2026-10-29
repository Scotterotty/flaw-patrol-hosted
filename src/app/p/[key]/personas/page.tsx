import { redirect } from "next/navigation";

/** Personas live on the Charters page's Personas tab since ver_96. */
export default async function PersonasPage({ params }: { params: Promise<{ key: string }> }) {
  redirect(`/p/${(await params).key}/charters?tab=personas`);
}
