/** A bug saved without Jira: what the tester wrote under What happened, folded. */
export function BugDescription({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-medium text-accent-700 hover:underline">What happened</summary>
      <pre className="mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 font-sans whitespace-pre-wrap wrap-anywhere text-slate-700">{text}</pre>
    </details>
  );
}
