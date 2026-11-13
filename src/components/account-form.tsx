"use client";

import { useState, useTransition } from "react";
import { updateMyName } from "@/server/account";
import { Button, ErrorText, Field, Input } from "./ui";

export function AccountForm({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setSaved(false);
          const res = await updateMyName(value);
          if (!res.ok) return setError(res.error);
          setError(null);
          setSaved(true);
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Field label="Your name" htmlFor="account-name" hint="Shown to your team on cases, runs and results, including ones you've already recorded.">
        <Input id="account-name" className="max-w-md" value={value} onChange={(e) => setValue(e.target.value)} required maxLength={100} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !value.trim() || value.trim() === name}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-sm text-emerald-700">Saved</span>}
      </div>
    </form>
  );
}
