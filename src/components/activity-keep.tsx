"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setActivityKeep } from "@/server/workspace";
import { InfoTip, Select } from "./ui";

export function ActivityKeep({ days, choices }: { days: number; choices: (readonly [number, string])[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2">
      Keep entries for
      <Select
        aria-label="Keep entries for"
        className="h-7 w-auto text-xs"
        defaultValue={days}
        disabled={pending}
        onChange={(e) => {
          const d = Number(e.target.value);
          start(async () => {
            const res = await setActivityKeep(d);
            setError(res.ok ? null : res.error);
            router.refresh();
          });
        }}
      >
        {choices.map(([d, label]) => (
          <option key={d} value={d}>
            {label}
          </option>
        ))}
      </Select>
      <InfoTip text="Older entries are removed automatically. Nobody, including admins, can edit or delete single entries." />
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}
