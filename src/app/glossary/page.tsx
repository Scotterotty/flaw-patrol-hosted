import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { glossaryHome } from "./where";

/** /glossary opens the team's Glossary in the project you were last in. */
export default async function GlossaryLink() {
  const home = await glossaryHome(await requireUser());
  if (!home) notFound();
  redirect(home);
}
