import { pawnOf } from "@/lib/quest-gear";

/**
 * What's inside a pawn's colored circle: its emoji, or for "My picture" the
 * profile picture with the pawn color showing as a ring. No picture falls back to Classic.
 */
export function PawnFace({ pawn, photo }: { pawn: string; photo?: string | null }) {
  if (pawn === "photo" && photo)
    return (
      <span className="block size-full rounded-full p-[3px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" className="size-full rounded-full object-cover" />
      </span>
    );
  return <>{pawnOf(pawn === "photo" ? "classic" : pawn).emoji}</>;
}
