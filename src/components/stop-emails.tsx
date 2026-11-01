"use client";

import { useState, useTransition } from "react";
import { stopDigestEmails } from "@/server/digests";
import { Button, ErrorText } from "./ui";

export function StopEmailsButton({ token }: { token: string }) {
  const [done, setDone] = useState<{ member: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done)
    return (
      <p role="status" className="text-sm text-emerald-700">
        ✓ Stopped. {done.member ? "Change it back any time in Your account → Emails I get." : "You won't get these emails from Flaw Patrol again."}
      </p>
    );
  return (
    <div className="space-y-3">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await stopDigestEmails(token);
            if (!r.ok) return setError(r.error);
            setDone({ member: r.member });
          })
        }
      >
        Stop these emails
      </Button>
    </div>
  );
}
