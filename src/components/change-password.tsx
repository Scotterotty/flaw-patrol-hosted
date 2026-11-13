"use client";

import { useRef, useState, useTransition } from "react";
import { changeMyPassword } from "@/server/passwords";
import { Button, ErrorText, Field, Input } from "./ui";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      ref={form}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setSaved(false);
          const res = await changeMyPassword({
            current: String(fd.get("current") ?? ""),
            next: String(fd.get("next")),
            confirm: String(fd.get("confirm")),
          });
          if (!res.ok) return setError(res.error);
          setError(null);
          setSaved(true);
          form.current?.reset();
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {hasPassword && (
        <Field label="Current password" htmlFor="pw-current">
          <Input
            id="pw-current"
            className="max-w-md"
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="New password"
          htmlFor="pw-next"
          hint="At least 8 characters."
        >
          <Input
            id="pw-next"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm">
          <Input
            id="pw-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : hasPassword
              ? "Change password"
              : "Set password"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-700">Password saved</span>
        )}
      </div>
    </form>
  );
}
