"use client";

import { useState, useTransition } from "react";
import { acceptInvite } from "@/server/passwords";
import { Button, ErrorText, Field, Input } from "./ui";

/**
 * The invite page's password form (ver_137): your name, if Flaw Patrol doesn't have it yet,
 * and a password. Pressing the button signs you straight in and opens your home page.
 */
export function AcceptInviteForm({ token, askName }: { token: string; askName: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await acceptInvite(token, { name: String(fd.get("name") ?? ""), next: String(fd.get("password")), confirm: String(fd.get("confirm")) });
          // Success redirects home; we only get here with an error.
          if (res && !res.ok) setError(res.error);
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {askName && (
        <Field label="Your name" htmlFor="name" hint="Your team sees this on runs, bugs and bashes.">
          <Input id="name" name="name" autoComplete="name" required maxLength={80} autoFocus />
        </Field>
      )}
      <Field label="Choose a password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus={!askName} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Signing you in…" : "Choose password and sign in"}
      </Button>
    </form>
  );
}
