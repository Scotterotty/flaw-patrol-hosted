import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { glossaryHome } from "../where";

/** A term's own link, for pasting in chat: /glossary/repro-rate. */
export default async function GlossaryTermLink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = await glossaryHome(await requireUser());
  if (!home) notFound();
  redirect(`${home}?term=${encodeURIComponent(slug)}`);
}
