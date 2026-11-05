"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createCiToken, revokeCiToken } from "@/server/ci-tokens";
import { Button, ErrorText, Input } from "./ui";

export type CiTokenRow = { id: string; name: string; last4: string; createdBy: string; created: string; lastUsed: string | null };

/**
 * CI uploads, on the umbrella's Settings: tokens a pipeline sends with its
 * results file. A new token shows once; Flaw Patrol only keeps its hash.
 */
export function CiUploadsPanel({ groupId, tokens, platforms, canManage }: { groupId: string; tokens: CiTokenRow[]; platforms: string[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://your-flaw-patrol");
  const [pending, start] = useTransition();
  useEffect(() => setOrigin(window.location.origin), []);

  const platform = platforms[0] ?? "Web";
  const curl = [
    `curl -X POST ${origin}/api/ci/results \\`,
    `  -H "Authorization: Bearer $FLAW_PATROL_TOKEN" \\`,
    `  -F platform=${platform} -F build=$BUILD_ID \\`,
    `  -F file=@reports/junit.xml`,
  ].join("\n");
  const actions = [
    `- name: Send test results to Flaw Patrol`,
    `  if: always()`,
    `  run: |`,
    `    curl -sS --fail-with-body -X POST ${origin}/api/ci/results \\`,
    `      -H "Authorization: Bearer \${{ secrets.FLAW_PATROL_TOKEN }}" \\`,
    `      -F platform=${platform} -F build=\${{ github.run_number }} \\`,
    `      -F file=@reports/junit.xml`,
  ].join("\n");
  const copy = (what: string, text: string) =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });

  const make = () =>
    start(async () => {
      setError(null);
      const r = await createCiToken(groupId, name);
      if (!r.ok) return setError(r.error);
      setFresh(r.token);
      setName("");
      router.refresh();
    });
  const revoke = (id: string) =>
    start(async () => {
      setError(null);
      const r = await revokeCiToken(id);
      if (!r.ok) return setError(r.error);
      setRevoking(null);
      router.refresh();
    });

  return (
    <div className="space-y-3 text-sm" data-testid="ci-uploads">
      <p className="text-slate-600">
        Your pipeline sends its results file (JUnit or NUnit) after each build. Results land like <em>Upload automation results</em>, matched to cases the same way, in the newest test cycle for the
        platform it names. To pick one, add <code className="rounded bg-slate-100 px-1">-F cycle=KEY</code>. For screenshots, videos and replays, send a zip of the results file and Playwright&apos;s test-results folder instead of the .xml (up to 200 MB).
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {fresh && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3" role="status">
          <p className="font-medium text-amber-900">Copy this token now. You won&apos;t see it again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-surface px-2 py-1 font-mono text-xs break-all text-slate-900" data-testid="ci-new-token">
              {fresh}
            </code>
            <Button size="sm" onClick={() => copy("token", fresh)}>
              {copied === "token" ? "Copied" : "Copy token"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
          <p className="mt-2 text-xs text-amber-900">Save it in your CI as a secret named FLAW_PATROL_TOKEN.</p>
        </div>
      )}
      {tokens.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium text-slate-900">{t.name}</span> <code className="font-mono text-xs text-slate-500">fp_ci_••••{t.last4}</code>
                <span className="block text-xs text-slate-500">
                  Made by {t.createdBy || "someone"} {t.created} · {t.lastUsed ? `last used ${t.lastUsed}` : "not used yet"}
                </span>
              </span>
              {canManage &&
                (revoking === t.id ? (
                  <span className="flex items-center gap-2 text-xs text-slate-700">
                    Pipelines using it stop working.
                    <Button size="sm" variant="danger" disabled={pending} onClick={() => revoke(t.id)}>
                      Revoke
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevoking(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setRevoking(t.id)}>
                    Revoke
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">No tokens yet.</p>
      )}
      {canManage && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            make();
          }}
        >
          <Input aria-label="Token name" data-howto="ci-token-name" placeholder="What uses it, like GitHub Actions" className="h-8 w-72" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" type="submit" variant="primary" disabled={pending} data-howto="ci-new-token">
            + New token
          </Button>
        </form>
      )}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">Send results</span>
          <span className="flex gap-1.5">
            <Button size="sm" onClick={() => copy("actions", actions)}>
              {copied === "actions" ? "Copied" : "Copy GitHub Actions step"}
            </Button>
            <Button size="sm" onClick={() => copy("curl", curl)}>
              {copied === "curl" ? "Copied" : "Copy curl"}
            </Button>
          </span>
        </div>
        <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">{curl}</pre>
      </div>
    </div>
  );
}
