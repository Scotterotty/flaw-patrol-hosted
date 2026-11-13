"use client";

import { useEffect, useState, useTransition } from "react";
import { checkMyJira, saveMyJiraEmail } from "@/server/jira";
import { Button, ErrorText, Field, Input } from "./ui";

type Match = { site: string | null; name: string | null };

/** The email of your Jira account, so bugs you file show you as their Reporter. */
export function JiraEmailForm({ jiraEmail, email }: { jiraEmail: string | null; email: string }) {
  const [value, setValue] = useState(jiraEmail ?? "");
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    checkMyJira().then((res) => res.ok && setMatch(res));
    // "Link my Jira account" in the bug box lands straight in this box.
    if (window.location.hash === "#jira") requestAnimationFrame(() => document.getElementById("jira-email-own")?.focus());
  }, []);

  const save = () =>
    start(async () => {
      const res = await saveMyJiraEmail(value);
      if (!res.ok) return setError(res.error);
      setError(null);
      setValue(res.jiraEmail ?? "");
      setMatch(res);
    });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="text-xs text-slate-500">
        Bugs you file from Flaw Patrol show you as the Reporter in Jira. We find your Jira account by email. If you sign in to Jira with a different email, put it
        here.
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Field label="Jira email (only if different)" htmlFor="jira-email-own">
        <Input id="jira-email-own" type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder={email} className="max-w-md" />
      </Field>
      {match?.site && (
        <p role="status" className={match.name ? "flex items-center gap-2 text-sm text-emerald-700" : "flex items-center gap-2 text-sm text-amber-800"}>
          {match.name ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span>
                Found in Jira: <strong className="font-semibold">{match.name}</strong>
              </span>
            </>
          ) : (
            <span>No Jira account on {match.site} has the email {(value.trim() || email).toLowerCase()}. Bugs you file will name you in the description instead.</span>
          )}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Checking…" : "Save and check"}
      </Button>
    </form>
  );
}
