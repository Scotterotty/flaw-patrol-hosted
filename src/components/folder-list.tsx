"use client";

import Link from "next/link";
import { cx } from "./ui";

export type ListFolder = { id: string; name: string; depth: number; group: string; ids: string[] };

/** "none" picks the cases that aren't in any folder. */
export const UNFILED = "none";

/** Does a case sit in the picked folder (or anything under it)? "" is every case. */
export function inFolder(folders: ListFolder[], picked: string) {
  if (!picked) return () => true;
  if (picked === UNFILED) return (c: { folderId: string | null }) => !c.folderId;
  const ids = new Set(folders.find((f) => f.id === picked)?.ids ?? []);
  return (c: { folderId: string | null }) => !!c.folderId && ids.has(c.folderId);
}

/**
 * The Case library's folders beside the cases (ver_99, folder picker option B): short
 * names indented under their parent, with case counts. Clicking one shows its cases.
 */
export function FolderList({ folders, cases, value, onChange }: { folders: ListFolder[]; cases: { folderId: string | null }[]; value: string; onChange: (id: string) => void }) {
  const count = (id: string) => cases.filter(inFolder(folders, id)).length;
  const unfiled = count(UNFILED);
  const row = (id: string, name: string, depth: number, n: number, muted = false) => (
    <button
      key={id || "all"}
      type="button"
      aria-pressed={value === id}
      onClick={() => onChange(id)}
      className={cx("flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-accent-50", value === id ? "bg-accent-50 font-semibold text-accent-700" : muted ? "text-slate-500 italic" : "text-slate-800")}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="min-w-0 truncate">{name}</span>
      <span className="font-normal text-slate-500 tabular-nums">{n}</span>
    </button>
  );
  let group = "";
  return (
    <nav aria-label="Folders" className="max-h-72 space-y-px overflow-y-auto p-1.5" data-testid="folder-list">
      {row("", "All cases", 0, cases.length)}
      {folders.flatMap((f) => {
        const head = f.group && f.group !== group ? (group = f.group) : null;
        return [
          head && (
            <p key={`g-${head}`} className="px-1.5 pt-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {head}
            </p>
          ),
          row(f.id, f.name, f.depth, count(f.id)),
        ];
      })}
      {unfiled > 0 && folders.length > 0 && row(UNFILED, "Not in a folder", 0, unfiled, true)}
    </nav>
  );
}

/**
 * "Can't find a case?" (Scott, ver_99): the real reasons a case is missing from a picker.
 */
export function CantFindCase({ archived, bracketTitles, umbrellaName, libraryKey }: { archived: number; bracketTitles: number; umbrellaName: string | null; libraryKey: string }) {
  return (
    <details className="border-t border-slate-200 px-3 py-1.5 text-xs text-slate-700" data-testid="cant-find">
      <summary className="cursor-pointer font-medium text-accent-700">Can&apos;t find a case?</summary>
      <ul className="mt-1.5 mb-1 list-disc space-y-1 pl-4">
        <li>
          <b>A filter is on.</b> Check the folder, tag and search boxes, or click <b>All cases</b>.
        </li>
        {archived > 0 && (
          <li>
            <b>It&apos;s archived.</b> {archived} archived {archived === 1 ? "case is" : "cases are"} hidden. Restore them from{" "}
            <Link className="font-medium text-accent-700 underline" href={`/p/${libraryKey}/cases?archived=1`}>
              Case library → Archived
            </Link>
            .
          </li>
        )}
        {bracketTitles > 0 && (
          <li>
            <b>Its tag is a word in the title.</b> [UNITY] or [WEB] at the start of a title isn&apos;t a tag until you use <b>Review…</b> in the{" "}
            <Link className="font-medium text-accent-700 underline" href={`/p/${libraryKey}/cases`}>
              Case library
            </Link>
            .
          </li>
        )}
        {umbrellaName && (
          <li>
            <b>It&apos;s in a different umbrella.</b> Only {umbrellaName}&apos;s Case library shows here.
          </li>
        )}
      </ul>
    </details>
  );
}
