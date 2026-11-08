import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

/**
 * Where sign-in lands when no page was asked for (Monday audit): straight into your umbrella
 * when you're in only one, so the whole team skips a list with one card every morning.
 * In two or more, the Umbrellas list as before. "Umbrellas" at the top still opens the list.
 */
export default async function StartPage() {
  const user = await requireUser();
  const mine = user.isAdmin ? {} : { members: { some: { userId: user.id } } };
  const umbrellas = await db.projectGroup.findMany({
    where: { hubProjectId: { not: null }, archivedAt: null, hub: mine },
    select: { id: true },
    take: 2,
  });
  redirect(umbrellas.length === 1 ? `/g/${umbrellas[0].id}` : "/");
}
