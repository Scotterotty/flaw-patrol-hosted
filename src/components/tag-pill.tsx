"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { autoTagColor, TAG_COLORS, tagColor, type TagColors } from "@/lib/tags";
import { renameTag, setTagColor } from "@/server/tags";
import { Button, cx, ErrorText, Input } from "./ui";

/** A colored case tag (ver_96), shown before case titles. `hit` outlines it when a search matched it. */
export function TagPill({ tag, color, hit = false, className, children }: { tag: string; color?: string; hit?: boolean; className?: string; children?: ReactNode }) {
  const c = color ?? autoTagColor(tag);
  return (
    <span
      className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px align-middle text-[11px] leading-4 font-semibold whitespace-nowrap", hit && "ring-2 ring-offset-1 ring-offset-surface", className)}
      style={{ background: `color-mix(in oklab, ${c} 16%, var(--color-surface))`, color: `color-mix(in oklab, ${c} 78%, var(--color-slate-900))`, ...(hit ? { ["--tw-ring-color" as string]: c } : {}) }}
      data-testid="tag-pill"
    >
      {tag}
      {children}
    </span>
  );
}

/** The case's tags as pills, in front of its title. */
export function TagPills({ tags, colors, hits }: { tags: string[]; colors?: TagColors; hits?: string[] }) {
  if (!tags.length) return null;
  const h = new Set((hits ?? []).map((x) => x.toLowerCase()));
  return (
    <>
      {tags.map((t) => (
        <TagPill key={t} tag={t} color={tagColor(t, colors)} hit={h.has(t.toLowerCase())} />
      ))}
    </>
  );
}

/**
 * The Tags row above the Case library table (ver_96): every tag with how many cases have
 * it. Click to show only those cases (click more to narrow it). Right-click, or press
 * and hold on a phone, to change a tag's color or rename it everywhere.
 */
export function TagsRow({ projectId, tags, colors, picked, query, canEdit }: { projectId: string; tags: { tag: string; count: number }[]; colors: TagColors; picked: string[]; /** The page's other filters, kept when a tag is clicked. */ query: string; canEdit: boolean }) {
  const hrefFor = (next: string[]) => {
    const u = new URLSearchParams(query);
    if (next.length) u.set("tag", next.join(","));
    return `?${u.toString()}`;
  };
  const [menu, setMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!tags.length) return null;
  const on = new Set(picked.map((t) => t.toLowerCase()));
  const open = (tag: string, x: number, y: number) => canEdit && setMenu({ tag, x, y });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="tags-row">
      <span className="mr-1 text-xs font-semibold text-slate-600">Tags</span>
      {tags.map(({ tag, count }) => {
        const isOn = on.has(tag.toLowerCase());
        const next = isOn ? picked.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...picked, tag];
        return (
          <Link
            key={tag}
            href={hrefFor(next)}
            aria-pressed={isOn}
            title={canEdit ? `${isOn ? "Stop showing only" : "Show only"} ${tag} cases. Right-click to change its color or rename it.` : undefined}
            onContextMenu={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              open(tag, e.clientX, e.clientY);
            }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              hold.current = setTimeout(() => open(tag, t.clientX, t.clientY), 550);
            }}
            onTouchEnd={() => hold.current && clearTimeout(hold.current)}
            className={cx("rounded-full", isOn && "ring-2 ring-accent-500")}
          >
            <TagPill tag={tag} color={tagColor(tag, colors)} className="cursor-pointer px-2 py-0.5 text-xs">
              <span className="font-normal opacity-70 tabular-nums">{count}</span>
            </TagPill>
          </Link>
        );
      })}
      {picked.length > 0 && (
        <Link href={hrefFor([])} className="ml-1 text-xs text-slate-500 hover:underline">
          Show all tags
        </Link>
      )}
      {menu && <TagMenu projectId={projectId} tag={menu.tag} x={menu.x} y={menu.y} current={tagColor(menu.tag, colors)} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TagMenu({ projectId, tag, x, y, current, onClose }: { projectId: string; tag: string; x: number; y: number; current: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(tag);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const left = typeof window !== "undefined" ? Math.min(x, window.innerWidth - 260) : x;
  return (
    <div ref={ref} role="menu" aria-label={`${tag} tag`} className="fixed z-50 w-60 rounded-lg border border-slate-200 bg-surface p-3 shadow-lg" style={{ left, top: y + 6 }}>
      <p className="mb-1.5 text-xs font-semibold text-slate-700">Color</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={c === current}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setTagColor(projectId, tag, c);
                if (!r.ok) return setError(r.error);
                onClose();
                router.refresh();
              })
            }
            className={cx("size-6 rounded-full", c === current && "ring-2 ring-slate-900 ring-offset-2 ring-offset-surface")}
            style={{ background: c }}
          />
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await renameTag(projectId, tag, name);
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
      >
        <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="tag-rename">
          Rename everywhere
        </label>
        <div className="flex gap-1.5">
          <Input id="tag-rename" value={name} onChange={(e) => setName(e.target.value)} className="h-8" maxLength={24} />
          <Button size="sm" type="submit" disabled={pending || !name.trim() || name.trim() === tag}>
            Rename
          </Button>
        </div>
      </form>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}
