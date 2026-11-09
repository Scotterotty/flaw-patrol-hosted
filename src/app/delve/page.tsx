import { requireUser } from "@/lib/session";
import { DelveHost } from "@/components/delve-host";

export const metadata = { title: "The Delve" };

export default async function DelvePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireUser();
  const { from } = await searchParams;
  // Back goes to the page the door was opened on, and only ever to a page inside the app.
  const back = from && /^\/p\/[\w-]+\/quests(\/\d+)?$/.test(from) ? from : "/";
  return <DelveHost back={back} />;
}
