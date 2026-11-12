import { redirect } from "next/navigation";

/** Repositories became Status (ver_228): old links and bookmarks land there. */
export default async function ReposMoved({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/g/${(await params).id}/status`);
}
