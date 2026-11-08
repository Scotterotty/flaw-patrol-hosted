import { QuestMapOnButton } from "@/components/overview-extras";
import { EmptyState } from "@/components/ui";

/** Shown when someone opens a quest page without quest maps turned on. */
export function QuestOff() {
  return (
    <div className="max-w-xl">
      <EmptyState title="Quest maps are off" action={<QuestMapOnButton />}>
        Every test run becomes a quest map. Turning it on also turns on the mini game (XP, levels and titles). You can turn either off again in Your account.
      </EmptyState>
    </div>
  );
}
