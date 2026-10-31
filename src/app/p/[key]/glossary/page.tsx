import { redirect } from "next/navigation";
import { GlossaryPage } from "@/components/glossary-page";
import { charterHome } from "@/lib/charter-data";
import { CROWN_DAYS, toTake, WORDS_NEED } from "@/lib/crowns";
import { db } from "@/lib/db";
import { glossaryPage, glossaryRights } from "@/lib/glossary-data";
import { projectAccess } from "@/lib/session";
import { umbrellaOf } from "@/lib/umbrella";

export const metadata = { title: "Glossary" };

/** Glossary (ver_113): the team's words and what they mean. One list for everyone, in every menu. */
export default async function GlossaryRoute({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ term?: string; edit?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const { user, project } = await projectAccess(key);
  // In an umbrella the Library lives on the hub, so the menu stays lit there.
  const home = await charterHome(project);
  if (home.id !== project.id && (user.isAdmin || (await db.projectMember.findUnique({ where: { projectId_userId: { projectId: home.id, userId: user.id } } })))) {
    const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    redirect(`/p/${home.key}/glossary${qs ? `?${qs}` : ""}`);
  }
  const [data, rights] = await Promise.all([glossaryPage(user), glossaryRights(user)]);
  // Keeper of Words (mini game players only): who holds it in this umbrella and how far you are.
  let crown: { holder: string | null; holderCount: number; mine: number; toTake: number; youHold: boolean } | null = null;
  if (user.gameEnabled) {
    const u = await umbrellaOf(project);
    const row = u ? await db.crown.findUnique({ where: { groupId_key: { groupId: u.group.id, key: "words" } } }) : null;
    if (row) {
      const counts = (row.counts ?? {}) as Record<string, number>;
      const holder = row.userId ? await db.user.findUnique({ where: { id: row.userId }, select: { name: true, email: true } }) : null;
      const holderCount = row.userId ? Number(counts[row.userId] ?? 0) : Math.max(0, ...Object.values(counts).map(Number));
      const mine = Number(counts[user.id] ?? 0);
      crown = { holder: holder ? holder.name || holder.email : null, holderCount, mine, youHold: row.userId === user.id, toTake: toTake({ mine, top: holderCount, need: WORDS_NEED, holderId: row.userId }) };
    }
  }
  return (
    <GlossaryPage
      rows={data.rows}
      groups={data.groups}
      answeredForMe={data.answeredForMe}
      me={user.id}
      rights={rights}
      underline={user.glossaryUnderline}
      focus={sp.term ?? null}
      edit={sp.edit ?? null}
      crown={crown}
      crownDays={CROWN_DAYS}
    />
  );
}
