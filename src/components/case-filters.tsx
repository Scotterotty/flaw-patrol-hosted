import { Select } from "@/components/ui";
import { PRIORITY_LABEL } from "@/lib/format";
import type { ReportFilters } from "@/lib/reports";

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/** The picked choice stays listed even when this tab has no case with it, so the box never lies. */
const withCurrent = (list: string[], cur: string | undefined) => (cur && !list.includes(cur) ? [cur, ...list] : list);

/**
 * Priority, Folder and Tag on every Reports tab. Session findings shows Tag only
 * (`tagsOnly`, the charters' tags) and Regression none (`hideAll`); a pick a tab doesn't show is
 * kept in a hidden field, so it is still there when you go back to another tab. Each box is keyed
 * on its value: it stays on screen between tabs now, and a saved view or Reset must show the new pick.
 */
export function CaseFilters({ f, options, tagsOnly, hideAll }: { f: ReportFilters; options: { tags: string[]; folders: string[] } | null; tagsOnly?: string[]; hideAll?: boolean }) {
  const keep = (name: string, v: string | undefined) => (v ? <input key={name} type="hidden" name={name} value={v} /> : null);
  if (hideAll || (!options && !tagsOnly)) return <>{[keep("priority", f.priority), keep("folder", f.folder), keep("tag", f.tag)]}</>;
  if (tagsOnly) {
    const tags = withCurrent(tagsOnly, f.tag);
    return (
      <>
        {keep("priority", f.priority)}
        {keep("folder", f.folder)}
        {tags.length > 0 ? <TagSelect tags={tags} value={f.tag} /> : keep("tag", f.tag)}
      </>
    );
  }
  const folders = withCurrent(options!.folders, f.folder);
  const tags = withCurrent(options!.tags, f.tag);
  return (
    <>
      <Select key={`priority-${f.priority ?? ""}`} name="priority" defaultValue={f.priority ?? ""} className="w-auto" aria-label="Priority">
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </Select>
      {folders.length > 0 && (
        <Select key={`folder-${f.folder ?? ""}`} name="folder" defaultValue={f.folder ?? ""} className="w-auto max-w-56" aria-label="Folder">
          <option value="">Any folder</option>
          {folders.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      )}
      {tags.length > 0 && <TagSelect tags={tags} value={f.tag} />}
    </>
  );
}

function TagSelect({ tags, value }: { tags: string[]; value?: string }) {
  return (
    <Select key={`tag-${value ?? ""}`} name="tag" defaultValue={value ?? ""} className="w-auto" aria-label="Tag">
      <option value="">Any tag</option>
      {tags.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </Select>
  );
}

/** "Oct 3 to Nov 1, only High priority cases in Checkout tagged web": the summary says what it counts. */
export function caseFilterWords(scope: string, f: ReportFilters) {
  if (!f.priority && !f.folder && !f.tag) return scope;
  const what = [`only ${f.priority ? `${PRIORITY_LABEL[f.priority]} priority ` : ""}cases`, f.folder && `in ${f.folder}`, f.tag && `tagged ${f.tag}`].filter(Boolean).join(" ");
  return `${scope}, ${what}`;
}
