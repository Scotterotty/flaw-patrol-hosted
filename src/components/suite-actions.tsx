"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setSuiteArchived } from "@/server/suites";
import { Button } from "./ui";

export function ArchiveSuiteButton({ projectId, suiteId, archived }: { projectId: string; suiteId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className={archived ? undefined : "text-red-700"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setSuiteArchived(projectId, suiteId, !archived);
          router.refresh();
        })
      }
    >
      {archived ? "Restore suite" : "Archive suite"}
    </Button>
  );
}
