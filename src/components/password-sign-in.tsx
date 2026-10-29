"use client";

import { useState, useTransition } from "react";
import { checkEmail, passwordSignIn } from "@/server/passwords";
import { Button, ErrorText, Field, Input } from "./ui";

/**
 * Email first, then either the password or, for someone without one yet,
 * "create your password" with a confirmation.
 */
export function PasswordSignIn({
  redirectTo,
  initialEmail = "",
}: {
  redirectTo: string;
  initialEmail?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<"email" | "password" | "create">("email");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const next = () =>
    start(async () => {
      const res = await checkEmail(email);
      if (!res.ok) return setError(res.error);
      setError(null);
      setStep(res.next);
    });

  const submit = (fd: FormData) =>
    start(async () => {
      const res = await passwordSignIn({
        email,
        password: String(fd.get("password") ?? ""),
        confirm: String(fd.get("confirm") ?? ""),
        name: String(fd.get("name") ?? ""),
        mode: step === "create" ? "create" : "password",
        redirectTo,
      });
      // Success redirects; we only get here with an error.
      if (res && !res.ok) setError(res.error);
    });

  if (step === "email") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={pending}
        >
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
    >
      <p className="flex items-center justify-between text-sm text-slate-700">
        <span className="truncate">{email}</span>
        <button
          type="button"
          className="text-xs text-accent-700 hover:underline"
          onClick={() => {
            setStep("email");
            setError(null);
          }}
        >
          Change
        </button>
      </p>
      {/* Lets password managers save the login against the email. */}
      <input
        type="email"
        name="username"
        value={email}
        autoComplete="username"
        readOnly
        hidden
      />
      {step === "create" && (
        <p className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700">
          Welcome! You don&apos;t have a password yet. Choose one to finish
          signing in. You&apos;ll use it from now on.
        </p>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {step === "create" ? (
        <>
          <Field
            label="Your name"
            htmlFor="name"
            hint="Shown to your team. You can change it later."
          >
            <Input id="name" name="name" autoComplete="name" />
          </Field>
          <Field
            label="New password"
            htmlFor="password"
            hint="At least 8 characters. A short phrase is easy to remember."
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
        </>
      ) : (
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </Field>
      )}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={pending}
      >
        {pending
          ? "Signing in…"
          : step === "create"
            ? "Set password and sign in"
            : "Sign in"}
      </Button>
      {step === "password" && (
        <p className="text-center text-xs text-slate-500">
          Forgot your password? Ask an admin for a password link.
        </p>
      )}
    </form>
  );
}
