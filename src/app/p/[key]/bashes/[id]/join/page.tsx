import { redirect } from "next/navigation";

/** Old Join address (Slack buttons, shared links): joining happens on the bash page itself since ver_121. */
export default async function JoinBashPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  redirect(`/p/${encodeURIComponent(key)}/bashes/${encodeURIComponent(id)}?join=1`);
}
