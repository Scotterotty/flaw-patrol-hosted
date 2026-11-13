import type { ReactNode } from "react";
import { splitNumberedSteps } from "@/lib/numbered-steps";

/**
 * Shows a Jira description or comment (Atlassian Document Format) as plain, readable HTML
 * for the bug panel (ver_211). Only text and simple layout: links must be http(s), pictures
 * point to Attachments, and anything unknown falls back to its text.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Node[] };

const safeHref = (h: unknown) => (typeof h === "string" && /^https?:\/\//i.test(h) ? h : null);

function marked(n: Node, key: number): ReactNode {
  let out: ReactNode = n.text ?? "";
  for (const m of n.marks ?? []) {
    if (m.type === "strong") out = <strong className="font-semibold">{out}</strong>;
    else if (m.type === "em") out = <em>{out}</em>;
    else if (m.type === "code") out = <code className="rounded bg-slate-100 px-1 font-mono text-[0.92em]">{out}</code>;
    else if (m.type === "strike") out = <s>{out}</s>;
    else if (m.type === "underline") out = <u>{out}</u>;
    else if (m.type === "link") {
      const href = safeHref(m.attrs?.href);
      if (href)
        out = (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent-700 underline">
            {out}
          </a>
        );
    }
  }
  return <span key={key}>{out}</span>;
}

/** Steps typed on one line ("1. … 2. … 3. …") as a lined-up numbered list (ver_231). */
function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="my-1 flex list-decimal flex-col gap-1 pl-6 marker:font-semibold" data-testid="jira-steps">
      {steps.map((s, i) => (
        <li key={i} className="pl-1">
          {s}
        </li>
      ))}
    </ol>
  );
}

/** A paragraph of plain text only (no links or bold), so splitting it loses nothing. */
function plainText(n: Node): string | null {
  let out = "";
  for (const c of n.content ?? []) {
    if (c.type === "hardBreak") out += "\n";
    else if (c.type === "text" && !c.marks?.length) out += c.text ?? "";
    else return null;
  }
  return out;
}

function kids(n: Node) {
  return (n.content ?? []).map((c, i) => <Adf key={i} node={c} k={i} />);
}

function Adf({ node: n, k }: { node: Node; k: number }): ReactNode {
  switch (n.type) {
    case "doc":
      return <>{kids(n)}</>;
    case "text":
      return marked(n, k);
    case "hardBreak":
      return <br />;
    case "paragraph": {
      const plain = plainText(n);
      const steps = plain === null ? null : splitNumberedSteps(plain);
      return steps ? <Steps steps={steps} /> : <p className="my-1">{kids(n)}</p>;
    }
    case "heading":
      return <p className="mt-2 mb-1 font-semibold text-slate-900">{kids(n)}</p>;
    case "bulletList":
      return <ul className="my-1 list-disc pl-5">{kids(n)}</ul>;
    case "orderedList":
      return <ol className="my-1 list-decimal pl-5">{kids(n)}</ol>;
    case "listItem":
      return <li>{kids(n)}</li>;
    case "blockquote":
    case "panel":
      return <div className="my-1 border-l-2 border-slate-300 pl-3">{kids(n)}</div>;
    case "codeBlock":
      return <pre className="my-1 overflow-x-auto rounded bg-slate-100 p-2 font-mono text-xs whitespace-pre-wrap">{kids(n)}</pre>;
    case "rule":
      return <hr className="my-2 border-slate-200" />;
    case "table":
      return (
        <div className="my-1 overflow-x-auto">
          <table className="text-xs">
            <tbody>{kids(n)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{kids(n)}</tr>;
    case "tableHeader":
      return <th className="border border-slate-200 px-2 py-1 text-left font-semibold">{kids(n)}</th>;
    case "tableCell":
      return <td className="border border-slate-200 px-2 py-1 align-top">{kids(n)}</td>;
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return <span className="text-xs text-slate-500 italic">(Picture: see Attachments)</span>;
    case "mention":
    case "emoji":
    case "status":
      return <span>{String(n.attrs?.text ?? n.attrs?.shortName ?? "")}</span>;
    case "inlineCard":
    case "blockCard": {
      const href = safeHref(n.attrs?.url);
      return href ? (
        <a href={href} target="_blank" rel="noreferrer" className="break-all text-accent-700 underline">
          {href}
        </a>
      ) : null;
    }
    default:
      return n.content ? <>{kids(n)}</> : n.text ? <span>{n.text}</span> : null;
  }
}

export function JiraAdf({ doc, empty = "Nothing written." }: { doc: unknown; empty?: string }) {
  // Older Jira sites send wiki text as a plain string.
  if (typeof doc === "string" && doc.trim())
    return (
      <div className="text-sm break-words text-slate-800">
        {doc
          .trim()
          .split(/\n\s*\n/)
          .map((p, i) => {
            const steps = splitNumberedSteps(p);
            return steps ? <Steps key={i} steps={steps} /> : <p key={i} className="my-1 whitespace-pre-wrap">{p.trim()}</p>;
          })}
      </div>
    );
  if (!doc || typeof doc !== "object") return <p className="text-sm text-slate-500">{empty}</p>;
  const n = doc as Node;
  if (n.type === "doc" && !(n.content ?? []).length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="text-sm break-words text-slate-800">
      <Adf node={n} k={0} />
    </div>
  );
}
