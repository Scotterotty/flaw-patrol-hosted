"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetWithLink } from "@/server/passwords";
import { Button, ErrorText, Field, Input } from "./ui";

export function ResetPasswordForm({ token, submitLabel = "Set password", passwordLabel = "New password" }: { token: string; submitLabel?: string; passwordLabel?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await resetWithLink(token, {
            next: String(fd.get("password")),
            confirm: String(fd.get("confirm")),
          });
          if (!res.ok) return setError(res.error);
          router.push(`/signin?email=${encodeURIComponent(res.email)}`);
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Field
        label={passwordLabel}
        htmlFor="password"
        hint="At least 8 characters."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          autoFocus
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
