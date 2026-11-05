"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { duplicateCase, restoreCaseVersion, setCasesArchived } from "@/server/cases";
import { addCasesToSuite } from "@/server/suites";
import { Button, ErrorText, Select } from "./ui";

export function CaseActions({
  projectId,
  projectKey,
  caseId,
  archived,
  canEdit,
  canArchive,
}: {
  projectId: string;
  projectKey: string;
  caseId: string;
  archived: boolean;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {canEdit && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await duplicateCase(projectId, caseId);
              if (!res.ok) return setError(res.error);
              router.push(`/p/${projectKey}/cases/${res.number}/edit`);
            })
          }
        >
          Duplicate
        </Button>
      )}
      {canArchive && (
        <Button
          variant="ghost"
          className={archived ? undefined : "text-red-700"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setCasesArchived(projectId, [caseId], !archived);
              if (!res.ok) return setError(res.error);
              router.refresh();
            })
          }
        >
          {archived ? "Restore case" : "Archive case"}
        </Button>
      )}
    </>
  );
}

/** "Add to suite…" on a case page: pick a suite and the case joins it. */
export function AddToSuite({ projectId, caseId, suites }: { projectId: string; caseId: string; suites: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {message && <span className="text-xs text-slate-500">{message}</span>}
      <Select
        aria-label="Add to suite"
        className="w-auto"
        value=""
        disabled={pending}
        onChange={(e) => {
          const suiteId = e.target.value;
          if (!suiteId) return;
          start(async () => {
            const res = await addCasesToSuite(projectId, suiteId, [caseId]);
            setMessage(res.ok ? (res.added ? `Added to ${suites.find((x) => x.id === suiteId)?.name}.` : "Already in that suite.") : res.error);
            router.refresh();
          });
        }}
      >
        <option value="">Add to suite…</option>
        {suites.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
    </span>
  );
}

export function RestoreVersionButton({ projectId, projectKey, caseId, number, version }: { projectId: string; projectKey: string; caseId: string; number: number; version: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Button
        variant="primary"
        disabled={pending}
        data-howto="case-restore"
        onClick={() =>
          start(async () => {
            const res = await restoreCaseVersion(projectId, caseId, version);
            if (!res.ok) return setError(res.error);
            router.push(`/p/${projectKey}/cases/${number}`);
            router.refresh();
          })
        }
      >
        Restore this version
      </Button>
    </>
  );
}
