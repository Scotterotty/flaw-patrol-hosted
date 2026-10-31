"use client";

import { BusyStrip, SpinnerArt } from "./loading-spinner";
import { PlatformPicker } from "./platform-picker";
import { RunFieldInputs } from "./run-field-inputs";
import type { RunField } from "@/lib/run-fields";
import { forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import { onStartKind } from "@/lib/start-kind";
import { LiveBashPill } from "./bash";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { Shortcut, ShortcutIcon as IconName } from "@/lib/umbrella";
import {
  addUmbrellaProject,
  createUmbrella,
  makeUmbrella,
  moveCasesIntoUmbrella,
  setKeepMembersSeparate,
  renamePlatform,
  setPlatforms,
  setShortcuts,
  setUmbrellaArchived,
  startNextRc,
} from "@/server/umbrella";
import { setProjectGroup } from "@/server/groups";
import type { GroupChoice } from "./group-dialogs";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Input, Textarea } from "./ui";
import { MoreMenu } from "./more-menu";
import { FolderCasePicker, type PickerCase } from "./folder-case-picker";
import { UmbrellaIcon } from "./umbrella-nav";

const ICON_PATHS: Record<IconName, ReactNode> = {
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5 3.5-5 3.5z" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5z" />
      <path d="M8 7h8" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  bug: (
    <>
      <rect x="8" y="6" width="8" height="14" rx="4" />
      <path d="M12 10v10M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  folder: (
    <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  down: <path d="M12 4v14M6 12l6 6 6-6" />,
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
};

export function ShortcutIcon({
  icon,
  className = "size-4",
}: {
  icon: IconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("flex-none", className)}
    >
      {ICON_PATHS[icon]}
    </svg>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(
    fn: () => Promise<({ ok: true } & T) | { ok: false; error: string }>,
    /** Returns true when it goes to another page itself, so this page isn't reloaded first (ver_108). */
    done?: (r: T) => void | boolean,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setError(null);
      if (done?.(r) !== true) router.refresh();
    });
  return { pending, error, setError, run, router };
}

/** A key from a name: "Oko Unity" → "OU", "OKO" → "OKO". */
export function keyFromName(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return key.replace(/^[0-9]+/, "").slice(0, 10);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One new project row in the New umbrella box: its platform, and its name once someone types their own. */
type NewRow = { id: number; platform: string; name: string | null };

/** "OKO Web RC23": the umbrella, the platform, then the release, skipping whichever is blank. */
const autoName = (umbrella: string, platform: string, rc: string) => [umbrella.trim(), platform.trim(), rc.trim()].filter(Boolean).join(" ");

/**
 * "New umbrella" on the Projects page, for everyone but Viewers (ver_97). It's the only way to
 * start new work: the box can make the umbrella's first projects (one per platform)
 * and take in projects that aren't in an umbrella yet, cases and all.
 */
export function NewUmbrellaButton({ choices, label = "New umbrella", variant = "primary" }: { choices: GroupChoice[]; label?: string; variant?: "primary" | "secondary" | "link" }) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run, router } = useAction();
  const [name, setName] = useState("");
  // The key follows the name until someone types their own.
  const [key, setKey] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [rc, setRc] = useState("");
  const [rows, setRows] = useState<NewRow[]>([{ id: 1, platform: "", name: null }]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bring, setBring] = useState(true);
  // Only projects outside any umbrella can move in; projects in an old-style group can too.
  const list = choices.filter((c) => c.canMove && !c.archived && !c.inUmbrella);
  const shownKey = key ?? keyFromName(name);
  const anyCases = list.some((c) => ticked.has(c.id) && (c.cases ?? 0) + (c.suites ?? 0) > 0);
  const umbrella = name.trim() || "the umbrella";
  const rowName = (r: NewRow) => r.name ?? (r.platform.trim() ? autoName(name, r.platform, rc) : "");
  const making = rows.filter((r) => rowName(r).trim());
  const setRow = (id: number, patch: Partial<NewRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const summary = [making.length && plural(making.length, "new test cycle"), ticked.size && `${ticked.size} moved in`].filter(Boolean).join(" and ");
  return (
    <>
      {/* A small link (ver_115) on the home page of someone waiting to join a team. */}
      {variant === "link" ? (
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-accent-700 hover:underline">
          {label}
        </button>
      ) : (
        <Button variant={variant} onClick={() => setOpen(true)} title="One home for a product's test cases, Jira and team, with a test cycle for each round of testing">
          <UmbrellaIcon className="mr-1 inline size-4 align-[-3px]" />
          {label}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New umbrella" wide>
        <p className="text-sm text-slate-500">
          An umbrella holds one product&apos;s test cases, Jira settings and team. Every test cycle under it uses them. Test cycles are where you run tests, one for each
          round of testing, such as one release on one platform.
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Product name" htmlFor="u-name">
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="The product you test" />
          </Field>
          <Field label="Key" htmlFor="u-key" hint={shownKey ? `Cases get IDs like ${shownKey}-12` : "Short code that starts every case ID"}>
            <Input id="u-key" value={shownKey} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={10} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Description (optional)" htmlFor="u-desc">
            <Textarea id="u-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        <fieldset className="mt-4 space-y-2 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Make its first test cycles</legend>
          <p className="text-xs text-slate-500">Optional. One test cycle per platform is typical. You can add more from {umbrella} any time.</p>
          <div className="max-w-[12rem]">
            <Field label="Release" htmlFor="u-rc">
              <Input id="u-rc" value={rc} onChange={(e) => setRc(e.target.value)} placeholder="e.g. 2.1 or RC 22" maxLength={30} />
            </Field>
          </div>
          <ul className="space-y-2" aria-label="New test cycles">
            {rows.map((r, i) => (
              <li key={r.id} className="grid grid-cols-[8rem_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? "Platform" : ""} htmlFor={`u-plat-${r.id}`}>
                  <Input id={`u-plat-${r.id}`} aria-label={`Platform ${i + 1}`} value={r.platform} onChange={(e) => setRow(r.id, { platform: e.target.value })} placeholder="Optional" maxLength={30} />
                </Field>
                <Field label={i === 0 ? "Test cycle name" : ""} htmlFor={`u-pname-${r.id}`}>
                  <Input
                    id={`u-pname-${r.id}`}
                    aria-label={`Test cycle name ${i + 1}`}
                    value={rowName(r)}
                    onChange={(e) => setRow(r.id, { name: e.target.value })}
                    placeholder={name && (r.platform || rc) ? autoName(name, r.platform, rc) : "Made from the name, platform and release"}
                    maxLength={100}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : [{ id: r.id + 1, platform: "", name: null }]))}
                  aria-label={`Remove test cycle ${i + 1}`}
                  className="mb-1.5 rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={() => setRows((rs) => [...rs, { id: Math.max(...rs.map((x) => x.id)) + 1, platform: "", name: null }])} disabled={rows.length >= 12}>
            ＋ Add a platform
          </Button>
          <p className="text-xs text-slate-500">No platforms? Leave Platform blank and just type a test cycle name, like &ldquo;Accessibility check&rdquo;.</p>
        </fieldset>

        {list.length > 0 && (
          <fieldset className="mt-3 rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">Move in test cycles you already have</legend>
            <p className="mb-2 text-xs text-slate-500">Optional. Only test cycles that aren&apos;t in an umbrella yet.</p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {list.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-accent-600"
                    checked={ticked.has(c.id)}
                    onChange={() =>
                      setTicked((s) => {
                        const n = new Set(s);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  />
                  {c.name}
                  <span className="text-xs text-slate-500">
                    {plural(c.cases ?? 0, "case")}
                    {c.suites ? `, ${plural(c.suites, "suite")}` : ""}
                    {c.groupName && ` · now in ${c.groupName}`}
                  </span>
                </label>
              ))}
            </div>
            {anyCases && (
              <label className="mt-2 flex items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-0.5 accent-accent-600" checked={bring} onChange={(e) => setBring(e.target.checked)} />
                <span>
                  Move their cases, suites and shared steps into the {umbrella} case library
                  <span className="block text-xs text-slate-500">Past runs keep their results. Same-name cases are matched, not doubled.</span>
                </span>
              </label>
            )}
          </fieldset>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  createUmbrella({
                    name,
                    key: shownKey,
                    description,
                    projectIds: [...ticked],
                    moveCases: bring && anyCases,
                    release: rc,
                    newProjects: making.map((r) => ({ platform: r.platform, name: rowName(r) })),
                  }),
                (r: { id: string }) => router.push(`/g/${r.id}`),
              )
            }
          >
            {pending ? "Making…" : `Make ${name.trim() || "umbrella"}${summary ? ` with ${summary}` : ""}`}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Project card ⋯ → Move into an umbrella…: the project joins the umbrella's team and Jira, and can bring its library along. */
export function MoveIntoUmbrella({
  project,
  umbrellas,
  onClose,
  onMoved,
}: {
  project: { id: string; name: string; cases: number };
  umbrellas: { id: string; name: string }[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const [to, setTo] = useState(umbrellas[0]?.id ?? "");
  const [bring, setBring] = useState(project.cases > 0);
  const { pending, error, setError, run } = useAction();
  const target = umbrellas.find((u) => u.id === to);
  return (
    <Modal open onClose={onClose} title={`Move ${project.name} into an umbrella`}>
      <p className="text-sm text-slate-500">It joins the umbrella&apos;s team, uses its Jira and bug template, and shows in its hub. Its runs and results stay as they are.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <fieldset className="mt-3 space-y-1">
        <legend className="mb-1 text-sm font-medium text-slate-700">Umbrella</legend>
        {umbrellas.map((u) => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="umbrella" className="accent-accent-600" checked={to === u.id} onChange={() => setTo(u.id)} />
            {u.name}
          </label>
        ))}
      </fieldset>
      {project.cases > 0 && (
        <label className="mt-3 flex items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-slate-800">
          <input type="checkbox" className="mt-0.5 accent-accent-600" checked={bring} onChange={(e) => setBring(e.target.checked)} />
          <span>
            Move its {plural(project.cases, "case")}, suites and shared steps into {target ? `the ${target.name} case library` : "the umbrella's Case library"}
            <span className="block text-xs text-slate-500">Same-name cases are matched, not doubled.</span>
          </span>
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={pending || !to}
          onClick={() =>
            run(
              async () => {
                const moved = await setProjectGroup(project.id, to);
                if (!moved.ok || !bring) return moved;
                return moveCasesIntoUmbrella(to, project.id);
              },
              () => {
                onClose();
                onMoved();
              },
            )
          }
        >
          {pending ? "Moving…" : "Move"}
        </Button>
      </div>
    </Modal>
  );
}

/** On a plain project group's page: turn it into an umbrella. */
export function MakeUmbrellaButton({
  groupId,
  name,
}: {
  groupId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10),
  );
  const { pending, error, setError, run } = useAction();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UmbrellaIcon className="mr-1 inline size-4 align-[-3px]" />
        Make it an umbrella
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Make ${name} an umbrella`}
      >
        <p className="text-sm text-slate-500">
          {name} gets its own home with a Case library, Jira setup and team.
          Its test cycles stay as they are. Everyone on any of them joins the
          umbrella&apos;s team, and you can move each test cycle&apos;s cases into
          the Case library later.
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="mt-3 w-40">
          <Field
            label="Key for its library"
            htmlFor="mk-key"
            hint={key ? `Cases get IDs like ${key}-12` : "Short code that starts every case ID"}
          >
            <Input
              id="mk-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              maxLength={10}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(
                () => makeUmbrella(groupId, key),
                () => setOpen(false),
              )
            }
          >
            Make umbrella
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Pages the shortcut editor offers, grouped by where they live. */
export type ShortcutChoice = { section: string; items: Shortcut[] };

/** Edit the umbrella card's shortcuts: pick pages from anywhere in the umbrella, or paste a link; reorder and remove. */
export function ShortcutsEditor({
  groupId,
  name,
  current,
  choices,
  onDone,
}: {
  groupId: string;
  name: string;
  current: Shortcut[];
  choices: ShortcutChoice[];
  onDone: () => void;
}) {
  const [list, setList] = useState(current);
  const [q, setQ] = useState("");
  const [link, setLink] = useState("");
  const [label, setLabel] = useState("");
  const { pending, error, setError, run } = useAction();
  const save = (next: Shortcut[]) => {
    setList(next);
    run(() => setShortcuts(groupId, next));
  };
  // Forgiving search (ver_96): exact matches in their sections, close ones under their own label.
  const found = forgivingFilter(
    choices.flatMap((c) => c.items.map((s) => ({ s, section: c.section }))),
    q,
    (x) => `${x.s.label} ${x.s.sub} ${x.section}`,
  );
  const exactSet = new Set(found.exact.map((x) => `${x.section}|${x.s.href}`));
  const matches = (s: Shortcut, section: string) => exactSet.has(`${section}|${s.href}`);
  const has = (href: string) => list.some((s) => s.href === href);
  const renderChoice = (s: Shortcut) => (
                  <li
                    key={s.href}
                    className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                  >
                    <ShortcutIcon
                      icon={s.icon}
                      className="size-4 text-accent-600"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate text-slate-800">
                        {s.label}
                      </span>
                      {s.sub && (
                        <span className="block truncate text-xs text-slate-500">
                          {s.sub}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={pending || has(s.href) || full}
                      onClick={() => save([...list, s])}
                      aria-label={
                        has(s.href) ? `${s.label} is pinned` : `Pin ${s.label}`
                      }
                      title={
                        has(s.href)
                          ? "Already pinned"
                          : full
                            ? "6 is the most; remove one first"
                            : "Pin"
                      }
                      className="rounded px-1.5 text-lg leading-none text-slate-400 hover:bg-accent-100 hover:text-accent-700 disabled:opacity-40"
                    >
                      {has(s.href) ? "✓" : "＋"}
                    </button>
                  </li>);
  const full = list.length >= 6;
  const move = (i: number, by: number) => {
    const next = [...list];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    save(next);
  };
  const addLink = () => {
    const path = pathOf(link);
    if (!path)
      return setError(
        "Paste a link to a Flaw Patrol page, such as one from your browser's address bar.",
      );
    if (!label.trim()) return setError("Give the shortcut a name.");
    save([...list, { label: label.trim(), sub: "", href: path, icon: "link" }]);
    setLink("");
    setLabel("");
  };
  return (
    <section
      aria-label={`Shortcuts on the ${name} card`}
      className="relative z-10 mt-3 rounded-xl border border-accent-500 bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-900">
            Shortcuts on the {name} card
          </h4>
          <p className="text-sm text-slate-500">
            Pin up to 6 pages from anywhere in {name} or its test cycles. Everyone
            sees the same ones. Anyone on the team can change them, unless an admin has limited it.
          </p>
        </div>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="mt-3 flex flex-wrap items-center gap-2">
        {list.map((s, i) => (
          <li
            key={s.href}
            className="inline-flex items-center gap-1 rounded-full bg-accent-50 py-1 pr-1 pl-2.5 text-sm text-accent-700"
          >
            <ShortcutIcon icon={s.icon} className="size-3.5" />
            <span>{s.label}</span>
            <button
              type="button"
              disabled={pending || i === 0}
              onClick={() => move(i, -1)}
              aria-label={`Move ${s.label} left`}
              className="rounded px-1 text-accent-500 hover:bg-accent-100 disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={pending || i === list.length - 1}
              onClick={() => move(i, 1)}
              aria-label={`Move ${s.label} right`}
              className="rounded px-1 text-accent-500 hover:bg-accent-100 disabled:opacity-30"
            >
              ›
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(list.filter((x) => x.href !== s.href))}
              aria-label={`Remove ${s.label}`}
              className="rounded px-1 hover:bg-accent-100"
            >
              ×
            </button>
          </li>
        ))}
        <li className="text-xs text-slate-500">{list.length} of 6</li>
      </ul>
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a page: runs, reports, a test cycle, a saved report"
        aria-label="Find a page"
        className="mt-3 w-full"
      />
      <div className="mt-3 grid max-h-80 gap-x-6 gap-y-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {choices.map((c) => {
          const items = c.items.filter((s) => matches(s, c.section));
          if (!items.length) return null;
          return (
            <div key={c.section}>
              <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                {c.section}
              </p>
              <ul>
                {items.map((s) => renderChoice(s))}
              </ul>
            </div>
          );
        })}
        {found.close.length > 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            {!found.exact.length && <p className="text-xs text-slate-500">No exact matches.</p>}
            <CloseMatchesLabel className="px-0" />
            <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{found.close.map((x) => renderChoice(x.s))}</ul>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-sm text-slate-500">
          Or paste a link to any Flaw Patrol page
        </span>
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste a link to a Flaw Patrol page"
          aria-label="Link to a Flaw Patrol page"
          className="min-w-48 flex-1"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Shortcut name"
          aria-label="Shortcut name"
          className="w-44"
          maxLength={40}
        />
        <Button disabled={pending || full} onClick={addLink}>
          Add
        </Button>
      </div>
    </section>
  );
}

/** Same rule as linkPath on the server: keep the path of a Flaw Patrol page, from any host. */
function pathOf(input: string) {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = s.startsWith("/") ? new URL(s, "http://x") : new URL(s);
    if (!/^(\/p\/|\/g\/|\/rc|\/account|\/$)/.test(u.pathname)) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

export type RcPlan = {
  umbrella: string;
  hubKey: string;
  suggested: string;
  lastRc: string;
  /** The umbrella's run fields, asked in the box (ver_99). */
  runFields: RunField[];
  allSuites: { id: string; name: string; cases: number; caseIds: string[] }[];
  /** The Case library as folders and cases, for Choose from folders… (ver_91). */
  library: { folders: { id: string; parentId: string | null; name: string }[]; cases: PickerCase[] };
  platforms: {
    name: string;
    suiteIds: string[];
    color: string;
    suites: string[];
    runs: number;
    cases: number;
    prev: { name: string; rc: string } | null;
    testers: string[];
    openBugs: string[];
    /** Runs still open in the last release on this platform. */
    openRuns: number;
    /** Library cases the last release ran here, who had each (by case id), and cases with open bugs (ver_91). */
    lastCaseIds: string[];
    /** The suites the last test cycle's runs used (ver_95). */
    lastSuiteIds: string[];
    assign: Record<string, string>;
    bugCaseIds: string[];
    /** Cases picked from folders last time, remembered for this platform. */
    remembered: string[];
  }[];
};

/** What one platform runs this release (ver_89; cases picked from folders since ver_91). */
type RcChoice = { kind: "suites"; ids: string[] } | { kind: "cases"; ids: string[] } | { kind: "empty" } | { kind: "newsuite"; name: string };

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** "Start next release": one new project per platform, with its runs set up from the shared suites. */
export function StartRcButton({
  groupId,
  plan,
  canManage = false,
  canSuites = false,
  variant = "primary",
  hideButton = false,
}: {
  groupId: string;
  plan: RcPlan;
  /** No button of its own (ver_95): Start a run's "Release candidate" kind opens it. */
  hideButton?: boolean;
  /** Secondary while the current release still needs its first run (ver_94). */
  variant?: "primary" | "secondary";
  /** Can rename or remove platforms, and the suites picked are remembered (umbrella:manage). */
  canManage?: boolean;
  /** Can make a new suite from the box (suite:manage). */
  canSuites?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The umbrella home's setup list links here (?start=rc) to add platforms and their suites.
  const asked = useSearchParams().get("start") === "rc";
  useEffect(() => {
    if (asked) setOpen(true);
  }, [asked]);
  useEffect(() => onStartKind("rc", () => setOpen(true)), []);
  // Nothing is picked for you (Scott, ver_99): the release name, platforms, what each runs and the
  // carry-over all start empty. Last release's choices are offered in each dropdown and as "Use Demo RC 2".
  const [rc, setRc] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [choices, setChoices] = useState<Record<string, RcChoice>>({});
  // Bumped as run fields are typed in, so the still-needed list keeps up.
  const [, setTyped] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  // The platform whose folder tree is open (ver_91).
  const [tree, setTree] = useState<string | null>(null);
  const [whoGets, setWhoGets] = useState(false);
  const [carry, setCarry] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const [closeOld, setCloseOld] = useState(false);
  // Platforms added here, each with the suite it runs (picked, not defaulted).
  const [added, setAdded] = useState<{ name: string; suiteId: string }[]>(() => (plan.platforms.length || !canManage ? [] : [{ name: "", suiteId: "" }]));
  // Platform changes save as they're made (ver_86): ⋯ Rename, ⋯ Remove (with Undo).
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [removed, setRemoved] = useState<{ at: number; name: string; suiteIds: string[]; color: string }[]>([]);
  const { pending, error, setError, run, router } = useAction();
  // The new release's Test runs page is on its way (ver_108): the box stays up until that page replaces this one.
  const [opening, setOpening] = useState<string | null>(null);
  const busy = pending || !!opening;
  // Start was pressed (ver_116): other saves in this box (Rename, Remove) don't show the strip.
  const [pressedStart, setPressedStart] = useState(false);
  useEffect(() => {
    if (!pending) setPressedStart(false);
  }, [pending]);
  const current = () => plan.platforms.map((p) => ({ name: p.name, suiteIds: p.suiteIds }));
  const suiteOf = (id: string) => plan.allSuites.find((s) => s.id === id);
  const caseCount = (p: RcPlan["platforms"][number], ids: string[]) => (sameIds(ids, p.suiteIds) ? p.cases : new Set(ids.flatMap((id) => suiteOf(id)?.caseIds ?? [])).size);
  // The cases a platform will run with its current choice, for the carry-over counts.
  const casesOf = (p: RcPlan["platforms"][number]): string[] => {
    const c = choices[p.name];
    if (!c) return [];
    if (c.kind === "cases") return c.ids;
    if (c.kind === "suites") return [...new Set(c.ids.flatMap((id) => suiteOf(id)?.caseIds ?? []))];
    // No runs yet: its first run gets last release's testers and bug re-checks.
    return [];
  };
  const keyOf = new Map(plan.library.cases.map((c) => [c.id, c.key]));
  const choose = (name: string, c: RcChoice | null, close = true) => {
    setChoices((all) => {
      const next = { ...all };
      if (c) next[name] = c;
      else delete next[name];
      return next;
    });
    if (close) {
      setMenu(null);
      setTree(null);
    }
  };
  const tick = (name: string) => {
    const on = picked.has(name);
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.delete(name);
      else n.add(name);
      return n;
    });
    // Ticking a platform that hasn't been told what to run opens its dropdown.
    if (!on && !choices[name]) setMenu(name);
    if (on && menu === name) setMenu(null);
  };
  const ready = (name: string) => {
    const c = choices[name];
    return picked.has(name) && !!c && (c.kind === "empty" || (c.kind === "suites" || c.kind === "cases" ? c.ids.length > 0 : !!c.name.trim()));
  };
  const remove = (name: string) => {
    const at = plan.platforms.findIndex((p) => p.name === name);
    const p = plan.platforms[at];
    run(
      () => setPlatforms(groupId, current().filter((x) => x.name !== name)),
      () => {
        setRemoved((r) => [...r, { at, name, suiteIds: p.suiteIds, color: p.color }]);
        setMenu(null);
      },
    );
  };
  const undo = (name: string) => {
    const gone = removed.find((r) => r.name === name)!;
    const list = current();
    list.splice(Math.min(gone.at, list.length), 0, { name: gone.name, suiteIds: gone.suiteIds });
    run(
      () => setPlatforms(groupId, list),
      () => setRemoved((r) => r.filter((x) => x.name !== name)),
    );
  };
  const rename = () => {
    if (!renaming) return;
    const { from, to } = renaming;
    const move = <T,>(o: Record<string, T>) => {
      const n = { ...o };
      if (from in n) {
        n[to.trim()] = n[from];
        delete n[from];
      }
      return n;
    };
    run(
      () => renamePlatform(groupId, from, to),
      () => {
        setRenaming(null);
        setChoices(move);
        setPicked((s) => {
          const n = new Set(s);
          if (n.delete(from)) n.add(to.trim());
          return n;
        });
      },
    );
  };
  const newOnes = added.filter((a) => a.name.trim() && a.suiteId);
  const fieldValue = (f: RunField) => (document.getElementById(f.id === "csp" ? "rc-csp" : `rc-f-${f.id}`) as HTMLInputElement | null)?.value.trim() ?? "";
  const chosen = plan.platforms.filter((p) => ready(p.name));
  const waiting = plan.platforms.filter((p) => picked.has(p.name) && !ready(p.name));
  const starting = [...chosen.map((p) => p.name), ...newOnes.map((a) => a.name.trim())];
  const start = async () => {
    if (newOnes.length) {
      const list = [...current(), ...newOnes.map((a) => ({ name: a.name.trim(), suiteIds: [a.suiteId] }))];
      const saved = await setPlatforms(groupId, list);
      if (!saved.ok) return saved;
    }
    const sent = Object.fromEntries(chosen.map((p) => [p.name, choices[p.name]]));
    const fields = Object.fromEntries(plan.runFields.map((f) => [f.id, fieldValue(f)]));
    return startNextRc(groupId, { rc, platforms: starting, carryAssignments: carry, recheckBugs: recheck, closeOld: closeOld && openRuns > 0, choices: sent, fields });
  };
  // Removed platforms stay in the list, crossed out, until the box closes, so Undo is right there.
  const rows: ({ kind: "live"; p: RcPlan["platforms"][number] } | { kind: "gone"; r: (typeof removed)[number] })[] = plan.platforms.map((p) => ({ kind: "live" as const, p }));
  for (const r of [...removed].sort((a, b) => a.at - b.at)) if (!plan.platforms.some((p) => p.name === r.name)) rows.splice(Math.min(r.at, rows.length), 0, { kind: "gone", r });
  // Same testers on the same cases goes case by case, per platform (ver_91): who gets how many.
  const split = chosen.map((p) => {
    const c = choices[p.name];
    const later = c?.kind === "empty" || c?.kind === "newsuite";
    const ids = later ? p.lastCaseIds : casesOf(p);
    const by = new Map<string, string[]>();
    let fresh = 0;
    for (const id of ids) {
      const who = p.assign[id];
      if (who) by.set(who, [...(by.get(who) ?? []), id]);
      else fresh++;
    }
    const people = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { p, later, people, fresh };
  });
  const anyAssigned = split.some((x) => x.people.length);
  const testers = split
    .filter((x) => x.people.length)
    .map((x) => `${x.p.name}: ${x.people.map(([who, ids]) => `${who} ${plural(ids.length, "case")}`).join(", ")}`);
  // A bug filed from two platforms counts once.
  const bugs = new Set(chosen.flatMap((p) => p.openBugs)).size;
  // Cases with open bugs that go to the top of each platform's run.
  const bugFirst = chosen
    .map((p) => {
      const ids = new Set(casesOf(p));
      const keys = p.bugCaseIds.filter((id) => ids.has(id)).map((id) => keyOf.get(id) ?? "");
      return keys.length ? `${list(keys.slice(0, 4))}${keys.length > 4 ? " and others" : ""} go to the top of the ${p.name} run` : "";
    })
    .filter(Boolean);
  const laterOnes = split.filter((x) => x.later).map((x) => x.p.name);
  const openRuns = chosen.reduce((n, p) => n + p.openRuns, 0);
  const oldCycles = chosen.filter((p) => p.openRuns > 0 && p.prev).map((p) => p.prev!.name);
  const last = plan.lastRc || "the last release";
  // Carry-over choices that can't apply become one plain line instead of grayed-out ticks.
  const nothing = [bugs === 0 && "no open bugs", openRuns === 0 && "no open runs"].filter(Boolean) as string[];
  // What can't carry over, as one plain sentence (ver_95): "Nobody was assigned in Demo RC 1 and it has no open bugs, so…"
  const facts = [!anyAssigned && `nobody was assigned in ${last}`, nothing.length && `${anyAssigned ? last : "it"} has ${list(nothing)}`].filter(Boolean) as string[];
  const missingFields = open ? plan.runFields.filter((f) => f.required && !fieldValue(f)) : [];
  const halfAdded = added.filter((a) => !!a.name.trim() !== !!a.suiteId);
  // What's still needed before Start works (ver_99).
  const todo: [boolean, string][] = [
    [!!rc.trim(), rc.trim() ? `Release: ${rc.trim()}` : "Name the release"],
    [starting.length > 0 || waiting.length > 0, starting.length || waiting.length ? `Platforms: ${list([...plan.platforms.filter((p) => picked.has(p.name)).map((p) => p.name), ...newOnes.map((a) => a.name.trim())])}` : "Tick a platform"],
    ...waiting.map((p): [boolean, string] => [false, `Pick test cases for ${p.name}`]),
    ...halfAdded.map((a): [boolean, string] => [false, a.name.trim() ? `Pick a suite for ${a.name.trim()}` : "Name the new platform"]),
    ...missingFields.map((f): [boolean, string] => [false, `Fill in ${f.name}`]),
  ];
  const allReady = todo.every(([ok]) => ok);
  const leftover = facts.length ? `${cap(facts.join(" and "))}, so there\u2019s nothing ${anyAssigned || bugs > 0 || openRuns > 0 ? "else " : ""}to carry over.` : "";
  const summary = (p: RcPlan["platforms"][number]) => {
    const c = choices[p.name];
    if (!c || ((c.kind === "suites" || c.kind === "cases") && !c.ids.length)) return <span className="text-slate-500">Pick test cases for {p.name}…</span>;
    if (c.kind === "cases") {
      const same = p.lastCaseIds.length > 0 && sameIds(c.ids, p.lastCaseIds);
      return (
        <span>
          {same ? (
            <>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">Same cases as {p.prev?.rc || last}</span> {plural(c.ids.length, "case")}
            </>
          ) : (
            <>Cases from folders · {c.ids.length} picked</>
          )}
        </span>
      );
    }
    if (c.kind === "empty")
      return (
        <span>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">＋ No runs yet</span> <span className="text-slate-500">start runs in it later</span>
        </span>
      );
    if (c.kind === "newsuite")
      return (
        <span>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">＋ New suite</span> {c.name.trim() || "Untitled suite"}
        </span>
      );
    const ranLast = !!p.prev && p.lastSuiteIds.length > 0 && sameIds(c.ids, p.lastSuiteIds);
    const again = ranLast || (!!p.prev && p.suiteIds.length > 0 && sameIds(c.ids, p.suiteIds));
    return (
      <span>
        {again && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
            Same {c.ids.length === 1 ? "suite" : "suites"} as {p.prev!.rc || last}
          </span>
        )}{" "}
        {c.ids.map((id) => suiteOf(id)?.name ?? "").join(", ")} · {plural(caseCount(p, c.ids), "case")}
      </span>
    );
  };
  return (
    <>
      {!hideButton && (
        <Button variant={variant} onClick={() => setOpen(true)}>
          {variant === "primary" ? "▶ " : ""}Start next release
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setRemoved([]);
          setMenu(null);
        }}
        title={`Start a new release in ${plan.umbrella}`}
        wide
        locked={busy}
      >
        <p className="text-sm text-slate-500">
          For testing a release candidate: makes one test cycle per platform in one go. Cases, suites, Jira and members come from {plan.umbrella}. For any
          other testing, like a sprint, a smoke check or a retest, use <b>Start a run</b>.
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {plan.allSuites.length === 0 && !canSuites ? (
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            Each platform runs a suite from the {plan.umbrella} case library, and there are none yet.{" "}
            <Link href={`/p/${plan.hubKey}/suites/new`} className="font-medium text-accent-700 hover:underline">
              Make the first suite
            </Link>
            , or move a test cycle&apos;s cases and suites into {plan.umbrella}.
          </p>
        ) : (
          <>
            <div className="mt-3 max-w-md">
              <Field
                label="Release"
                htmlFor="rc-name"
                hint={
                  plan.suggested && rc.trim() !== plan.suggested ? (
                    <span className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900" data-testid="rc-suggest">
                      <span>
                        The last one was <b>{plan.lastRc}</b>.
                      </span>
                      <Button size="sm" onClick={() => setRc(plan.suggested)}>
                        Use {plan.suggested}
                      </Button>
                    </span>
                  ) : undefined
                }
              >
                <Input id="rc-name" value={rc} onChange={(e) => setRc(e.target.value)} placeholder="e.g. 2.1 or RC 22" />
              </Field>
            </div>
            <p className="mt-4 mb-1.5 text-sm font-medium text-slate-700">
              Platforms <span className="font-normal text-slate-500">· tick the ones testing this release, then pick the test cases each one tests</span>
            </p>
            <div className="space-y-2">
              {rows.map((row) => {
                if (row.kind === "gone") {
                  const r = row.r;
                  return (
                    <div key={`gone-${r.name}`} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 opacity-60" data-testid="platform-row">
                      <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
                      <span className="text-sm font-medium text-slate-900 line-through">{r.name}</span>
                      <span className="min-w-0 flex-1 text-xs text-slate-500 line-through">Removed from {plan.umbrella}&apos;s platforms</span>
                      <button type="button" className="text-xs font-medium text-accent-700 underline" disabled={pending} onClick={() => undo(r.name)}>
                        Undo
                      </button>
                    </div>
                  );
                }
                const p = row.p;
                const on = picked.has(p.name);
                const c = choices[p.name];
                const ids = c?.kind === "suites" ? c.ids : [];
                const showMenu = on && menu === p.name;
                return (
                  <div key={p.name} className={cx("rounded-lg border px-3 py-2.5", on ? "border-accent-500 bg-accent-50/50" : "border-slate-200")} data-testid="platform-row">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <input type="checkbox" className="size-4 accent-accent-600" aria-label={p.name} checked={on} onChange={() => tick(p.name)} />
                      <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
                      {renaming?.from === p.name ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Input
                            aria-label={`New name for ${p.name}`}
                            value={renaming.to}
                            maxLength={30}
                            autoFocus
                            className="h-8 w-40"
                            onChange={(e) => setRenaming({ from: p.name, to: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") rename();
                              if (e.key === "Escape") setRenaming(null);
                            }}
                          />
                          <Button size="sm" variant="primary" disabled={pending || !renaming.to.trim()} onClick={rename}>
                            Rename
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                      )}
                      <span className="min-w-0 flex-1 text-xs text-slate-500">{on ? null : p.runs ? `${p.suites.join(", ")} · ${plural(p.cases, "case")}` : "No suites yet"}</span>
                      {canManage && (
                        <MoreMenu label="⋯" title={`More for ${p.name}`}>
                          <Button onClick={() => setRenaming({ from: p.name, to: p.name })}>Rename platform…</Button>
                          <Button onClick={() => remove(p.name)}>Remove from {plan.umbrella}</Button>
                        </MoreMenu>
                      )}
                    </div>
                    {on && (
                      <div className="mt-2 max-w-md pl-6">
                        <p className="mb-1 text-xs text-slate-500">Test cases for {p.name}</p>
                        <button
                          type="button"
                          aria-expanded={showMenu}
                          aria-label={`Test cases for ${p.name}`}
                          className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 text-left text-sm text-slate-800"
                          onClick={() => {
                            setTree(null);
                            setMenu(showMenu ? null : p.name);
                          }}
                        >
                          {summary(p)}
                          <span aria-hidden className="text-slate-400">
                            ▾
                          </span>
                        </button>
                        {showMenu && (
                          <div className="mt-1 rounded-lg border border-slate-200 bg-surface p-1.5 shadow-lg" role="group" aria-label={`Pick test cases for ${p.name}`}>
                            <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Last release</p>
                            {p.prev && p.lastSuiteIds.length > 0 && !sameIds(p.lastSuiteIds, p.suiteIds) && (
                              <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(p.name, { kind: "suites", ids: p.lastSuiteIds })}>
                                <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "suites" && sameIds(c.ids, p.lastSuiteIds) ? "✓" : ""}</span>
                                <span>
                                  <span className="block font-medium">
                                    Same {p.lastSuiteIds.length === 1 ? "suite" : "suites"} as {p.prev.rc}
                                  </span>
                                  <span className="block text-xs text-slate-500">{p.lastSuiteIds.map((id) => suiteOf(id)?.name ?? "").join(", ")}</span>
                                </span>
                              </button>
                            )}
                            {p.prev && p.suiteIds.length ? (
                              <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(p.name, { kind: "suites", ids: p.suiteIds })}>
                                <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "suites" && sameIds(c.ids, p.suiteIds) ? "✓" : ""}</span>
                                <span>
                                  <span className="block font-medium">Run {p.prev.rc || last}&apos;s suites again</span>
                                  <span className="block text-xs text-slate-500">
                                    {p.suites.join(", ")} · {plural(p.cases, "case")}
                                  </span>
                                </span>
                              </button>
                            ) : !p.lastCaseIds.length ? (
                              <p className="px-2 pb-1.5 text-xs text-slate-500">{p.prev ? `No suites were saved for ${p.name}.` : `${p.name} wasn't in ${last}.`}</p>
                            ) : null}
                            {p.prev && p.lastCaseIds.length > 0 && (
                              <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(p.name, { kind: "cases", ids: p.lastCaseIds })}>
                                <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "cases" && sameIds(c.ids, p.lastCaseIds) ? "✓" : ""}</span>
                                <span>
                                  <span className="block font-medium">
                                    Same {plural(p.lastCaseIds.length, "case")} as {p.prev.rc || last}
                                  </span>
                                  <span className="block text-xs text-slate-500">Every case {p.name} ran last release, from any folder or suite</span>
                                </span>
                              </button>
                            )}
                            {plan.allSuites.length > 0 && (
                              <>
                                <p className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Suites in {plan.umbrella}</p>
                                {plan.allSuites.map((s) => {
                                  const has = ids.includes(s.id);
                                  return (
                                    <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                                      <input
                                        type="checkbox"
                                        className="accent-accent-600"
                                        checked={has}
                                        onChange={() => {
                                          const next = has ? ids.filter((x) => x !== s.id) : [...ids, s.id];
                                          choose(p.name, next.length ? { kind: "suites", ids: next } : null, false);
                                        }}
                                      />
                                      <span className="flex-1">{s.name}</span>
                                      <span className="text-xs text-slate-500">{plural(s.cases, "case")}</span>
                                    </label>
                                  );
                                })}
                              </>
                            )}
                            <p className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Pick cases</p>
                            <button
                              type="button"
                              className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                              onClick={() => {
                                if (c?.kind !== "cases") choose(p.name, null, false);
                                setTree(p.name);
                                setMenu(null);
                              }}
                            >
                              <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "cases" && !sameIds(c.ids, p.lastCaseIds) ? "✓" : ""}</span>
                              <span>
                                <span className="block font-medium">Choose from folders…</span>
                                <span className="block text-xs text-slate-500">Tick whole folders or single cases</span>
                              </span>
                            </button>
                            <p className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Start brand new</p>
                            <button type="button" className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(p.name, { kind: "empty" })}>
                              <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "empty" ? "✓" : "＋"}</span>
                              <span>
                                <span className="block font-medium text-sky-800">No runs yet</span>
                                <span className="block text-xs text-slate-500">Makes the test cycle with no runs. Start runs in it from its page once the release is made.</span>
                              </span>
                            </button>
                            {canSuites && (
                              <div className="rounded-md px-2 py-1.5 text-sm">
                                <button type="button" className="flex w-full gap-2 text-left" onClick={() => choose(p.name, { kind: "newsuite", name: c?.kind === "newsuite" ? c.name : "" }, false)}>
                                  <span className="w-3.5 font-semibold text-accent-700">{c?.kind === "newsuite" ? "✓" : "＋"}</span>
                                  <span>
                                    <span className="block font-medium text-sky-800">New suite…</span>
                                    <span className="block text-xs text-slate-500">Name it here. It&apos;s made empty in the {plan.umbrella} library: add its cases, then start its run in the test cycle.</span>
                                  </span>
                                </button>
                                {c?.kind === "newsuite" && (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
                                    <Input
                                      aria-label="New suite name"
                                      autoFocus
                                      maxLength={100}
                                      className="h-8 w-56"
                                      value={c.name}
                                      placeholder={`${p.name} ${rc.trim() || "release"} checks`}
                                      onChange={(e) => choose(p.name, { kind: "newsuite", name: e.target.value }, false)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && c.name.trim()) setMenu(null);
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 px-2 pt-2">
                              <span className="text-xs text-slate-500">{canManage ? `What you pick is remembered for ${p.name}'s next release.` : ""}</span>
                              <Button size="sm" onClick={() => setMenu(null)}>
                                Done
                              </Button>
                            </div>
                          </div>
                        )}
                        {on && tree === p.name && (
                          <FolderCasePicker
                            title={`Choose ${p.name}'s cases`}
                            folders={plan.library.folders}
                            cases={plan.library.cases}
                            value={c?.kind === "cases" ? c.ids : []}
                            onChange={(ids) => choose(p.name, ids.length ? { kind: "cases", ids } : null, false)}
                            onDone={() => setTree(null)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {added.map((a, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 p-2">
                  <Input
                    aria-label="Platform name"
                    value={a.name}
                    onChange={(e) => setAdded((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder="Platform name"
                    className="w-44"
                  />
                  <SuitePick label="Suite to test" suites={plan.allSuites} value={a.suiteId} onChange={(id) => setAdded((l) => l.map((x, j) => (j === i ? { ...x, suiteId: id } : x)))} />
                  <Button size="sm" variant="ghost" onClick={() => setAdded((l) => l.filter((_, j) => j !== i))} aria-label="Remove this platform">
                    ✕ Remove
                  </Button>
                  <span className="basis-full text-xs text-slate-500">Added to {plan.umbrella}&apos;s platforms, so it shows up everywhere you pick a platform.</span>
                </div>
              ))}
              {canManage && plan.allSuites.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setAdded((l) => [...l, { name: "", suiteId: "" }])}>
                  ＋ New platform
                </Button>
              )}
            </div>
            {plan.platforms.some((p) => p.prev) && (
              <>
                <p className="mt-4 mb-1.5 text-sm font-medium text-slate-700">
                  Bring anything from {last}? <span className="font-normal text-slate-500">(optional)</span>
                </p>
                {chosen.length === 0 ? (
                  <p className="px-0.5 text-sm text-slate-500">Tick a platform to see what carries over.</p>
                ) : (
                <div className="space-y-2">
                  {anyAssigned && (
                  <Tick
                    on={carry}
                    toggle={() => setCarry(!carry)}
                    title="Same testers on the same cases"
                    sub={
                      anyAssigned ? (
                        <>
                          Case by case, per platform. {testers.join(". ")}.
                          {split.some((x) => x.fresh && x.people.length) ? " New cases start unassigned." : ""}{" "}
                          <button
                            type="button"
                            className="font-medium text-accent-700 underline"
                            aria-expanded={whoGets}
                            onClick={(e) => {
                              e.preventDefault();
                              setWhoGets(!whoGets);
                            }}
                          >
                            {whoGets ? "Hide who gets what" : "See who gets what"}
                          </button>
                        </>
                      ) : null
                    }
                  />
                  )}
                  {whoGets && anyAssigned && (
                    <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700" data-testid="who-gets-what">
                      {split
                        .filter((x) => x.people.length || x.fresh)
                        .map((x) => (
                          <div key={x.p.name} className="py-1">
                            <p className="font-semibold text-slate-900">{x.p.name}{x.later ? " (its first run)" : ""}</p>
                            <ul className="mt-0.5 space-y-0.5">
                              {x.people.map(([who, ids]) => (
                                <li key={who}>
                                  <span className="font-medium">{who}</span>: {ids.map((id) => keyOf.get(id)).join(", ")}
                                </li>
                              ))}
                              {x.fresh > 0 && <li className="text-slate-500">Unassigned: {plural(x.fresh, "case")}</li>}
                            </ul>
                          </div>
                        ))}
                    </div>
                  )}
                  {bugs > 0 && (
                    <Tick
                      on={recheck}
                      toggle={() => setRecheck(!recheck)}
                      title={`Re-check ${last}'s ${bugs} open ${bugs === 1 ? "bug" : "bugs"} first`}
                      sub={bugFirst.length ? `${bugFirst.join(". ")}, with "Bug still occurs" ready in each case's history.` : 'Their cases are put first, with "Bug still occurs" ready in each case\'s history'}
                    />
                  )}
                  {openRuns > 0 && (
                    <Tick
                      on={closeOld}
                      toggle={() => setCloseOld(!closeOld)}
                      title={`Close ${last}'s ${openRuns} open ${openRuns === 1 ? "run" : "runs"}`}
                      sub={`In ${list(oldCycles)}. Each can be reopened from its run page's More menu.`}
                    />
                  )}
                  {leftover && <p className="px-0.5 text-sm text-slate-500">{leftover}</p>}
                  {laterOnes.length > 0 && (carry || recheck) && (
                    <p className="px-0.5 text-sm text-slate-500">
                      {list(laterOnes)} {laterOnes.length === 1 ? "has" : "have"} no runs yet: testers and bug re-checks apply when you start {laterOnes.length === 1 ? "its" : "their"} first run.
                    </p>
                  )}
                </div>
                )}
              </>
            )}
            {rc.trim() && starting.length > 0 && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <p className="mb-1.5 text-sm font-medium text-slate-700">Pressing Start creates</p>
                <ul className="space-y-1.5 text-sm">
                  {chosen.map((p) => {
                    const c = choices[p.name];
                    return (
                      <li key={p.name} className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-700">Test cycle</span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-2 py-0.5 text-xs text-slate-800">
                          <span className="size-1.5 rounded-full" style={{ background: p.color }} aria-hidden />
                          {plan.umbrella} {p.name} {rc.trim()}
                        </span>
                        <span className="text-slate-500">
                          {c.kind === "suites"
                            ? `with ${plural(c.ids.length, "run")} of ${list(c.ids.map((id) => suiteOf(id)?.name ?? ""))} · ${plural(caseCount(p, c.ids), "case")}`
                            : c.kind === "cases"
                              ? `with 1 run · ${plural(c.ids.length, "case")}`
                              : c.kind === "empty"
                              ? "with no runs yet"
                              : `with no runs yet · new empty suite ${c.name.trim()} in the library`}
                        </span>
                      </li>
                    );
                  })}
                  {newOnes.map((a) => (
                    <li key={a.name} className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-700">Test cycle</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-2 py-0.5 text-xs text-slate-800">
                        {plan.umbrella} {a.name.trim()} {rc.trim()}
                      </span>
                      <span className="text-slate-500">with 1 run of {suiteOf(a.suiteId)?.name} · {plural(suiteOf(a.suiteId)?.cases ?? 0, "case")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.runFields.length > 0 && (
              <div className="mt-4 grid items-start gap-3 sm:grid-cols-2" onInput={() => setTyped((t) => t + 1)} data-testid="rc-fields">
                <RunFieldInputs fields={plan.runFields} prefix="rc" />
              </div>
            )}
          </>
        )}
        {/* Your spinner from the moment you press Start (ver_116), then "Opening Test runs…" (ver_108). */}
        {(opening || (pending && pressedStart)) && (
          <BusyStrip className="mt-4" testId={opening ? "run-opening" : "run-making"}>
            {opening ? (
              <p>
                <b>{opening}</b> is ready. Opening Test runs…
              </p>
            ) : (
              <>
                <p>
                  <b>Starting {rc.trim() || "the release"}…</b>
                </p>
                <p className="text-xs text-slate-600">Making {plural(starting.length, "test cycle")} and their runs</p>
              </>
            )}
          </BusyStrip>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <ul className="space-y-0.5 text-xs" aria-live="polite" data-testid="rc-todo">
            {todo.map(([ok, text]) => (
              <li key={text} className={ok ? "text-slate-700" : "text-slate-500"}>
                <span className={cx("mr-1", ok ? "text-emerald-600" : "text-slate-400")} aria-hidden>
                  {ok ? "✓" : "○"}
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setRemoved([]);
              setMenu(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !allReady}
            onClick={() => {
              setPressedStart(true);
              run(
                start,
                (r: { made: { key: string }[] }) => {
                  if (r.made.length !== 1) return setOpen(false);
                  // One test cycle: its Test runs page, with "Opening…" in the box until it shows.
                  setOpening(rc.trim() || "The release");
                  router.push(`/p/${r.made[0].key}/runs`);
                  return true;
                },
              );
            }}
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <SpinnerArt id="ring" size={14} />
                {opening ? "Opening…" : "Starting…"}
              </span>
            ) : `Start ${rc.trim() || "release"}${starting.length ? ` · ${plural(starting.length, "platform")}` : ""}`}
          </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function SuitePick({ label, suites, value, onChange }: { label: string; suites: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-slate-300 bg-surface px-2 text-sm text-slate-800"
    >
      <option value="">Pick a suite…</option>
      {suites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function list(names: string[]) {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function Tick({
  on,
  toggle,
  title,
  sub,
  aside,
  disabled,
}: {
  on: boolean;
  toggle: () => void;
  title: string;
  sub: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        on && !disabled
          ? "border-accent-500 bg-accent-50/50"
          : "border-slate-200",
        disabled ? "opacity-60" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        className="size-4 accent-accent-600"
        checked={on && !disabled}
        disabled={disabled}
        onChange={toggle}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>
      </span>
      {aside}
    </label>
  );
}

/** A project outside any umbrella that could move into this one. */
export type LooseProject = { id: string; name: string; key: string; cases: number };

/**
 * "Add project" on an umbrella: make a new project under it, or move in one that
 * isn't in an umbrella yet. As a menu in the hub's header, or as two buttons
 * where the umbrella has no projects at all.
 */
export function AddUmbrellaProject({
  groupId,
  umbrella,
  platforms,
  colors = [],
  loose,
  as = "menu",
  label = "＋ Add test cycle",
}: {
  groupId: string;
  umbrella: string;
  platforms: string[];
  /** Each platform's dot color, in the same order. */
  colors?: string[];
  loose: LooseProject[];
  as?: "menu" | "buttons";
  label?: string;
}) {
  const [box, setBox] = useState<"new" | "move" | null>(null);
  return (
    <>
      {as === "menu" ? (
        <MoreMenu label={label} title="A test cycle is one round of testing, such as one release on one platform. It holds that round's test runs, results and bugs.">
          <Button onClick={() => setBox("new")} className="!items-start text-left">
            <span>
              New test cycle
              <span className="block text-xs text-slate-500">Uses {umbrella}&apos;s cases, Jira and team</span>
            </span>
          </Button>
          {loose.length > 0 && (
          <Button onClick={() => setBox("move")} className="!items-start text-left">
            <span>
              Move in a test cycle you already have
              <span className="block text-xs text-slate-500">Its runs stay. Its cases can join the {umbrella} case library.</span>
            </span>
          </Button>
          )}
        </MoreMenu>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => setBox("new")}>
            New test cycle
          </Button>
          {loose.length > 0 && <Button onClick={() => setBox("move")}>Move in an existing one</Button>}
        </div>
      )}
      {box === "new" && <NewUmbrellaProject groupId={groupId} umbrella={umbrella} platforms={platforms} colors={colors} onClose={() => setBox(null)} />}
      {box === "move" && <MoveIntoThisUmbrella groupId={groupId} umbrella={umbrella} loose={loose} onClose={() => setBox(null)} />}
    </>
  );
}

/**
 * New project in an umbrella: one platform, one round of testing. It gets the umbrella's cases, Jira and team.
 * Pick a platform chip or add a new one; a new name joins the umbrella's platforms (ver_86).
 * Nothing is picked for you (ver_99).
 */
function NewUmbrellaProject({ groupId, umbrella, platforms, onClose }: { groupId: string; umbrella: string; platforms: string[]; colors: string[]; onClose: () => void }) {
  const [platform, setPlatform] = useState("");
  // The name box starts empty; the gray name (from the platform) is used if it's left blank. The key follows the name.
  const [name, setName] = useState("");
  const grayName = platform ? `${umbrella} ${platform}` : "";
  const shownName = name.trim() || grayName;
  const [key, setKey] = useState<string | null>(null);
  const { pending, error, setError, run, router } = useAction();
  const shownKey = key ?? keyFromName(shownName);
  return (
    <Modal open onClose={onClose} title={`New test cycle in ${umbrella}`}>
      <p className="text-sm text-slate-500">Testing a release candidate on every platform? Start a run, then Release candidate, makes one test cycle per platform in one go.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="mt-3 space-y-3">
        <Field label="Platform (optional)" htmlFor="ap-platform">
          <PlatformPicker id="ap-platform" platforms={platforms} umbrella={umbrella} value={platform} onChange={setPlatform} />
        </Field>
        <Field label="Name" htmlFor="ap-name" hint={grayName && !name.trim() ? "Leave it blank to use the suggested name shown." : undefined}>
          <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={grayName || "Name this round of testing, like Sprint 14"} />
        </Field>
      </div>
      <div className="mt-3 max-w-[8rem]">
        <Field label="Key" htmlFor="ap-key">
          <Input id="ap-key" value={shownKey} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={10} />
        </Field>
      </div>
      <div className="mt-3 space-y-0.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p className="font-medium text-slate-800">It gets from {umbrella}:</p>
        <p>✓ {umbrella}&apos;s test cases and suites, ready to run</p>
        <p>✓ {umbrella}&apos;s Jira and bug template</p>
        <p>✓ {umbrella}&apos;s team (you can switch this off later with Keep members separate)</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={pending || !shownName}
          onClick={() =>
            run(
              () => addUmbrellaProject(groupId, { name: shownName, key: shownKey, platform }),
              (r: { key: string }) => router.push(`/p/${r.key}`),
            )
          }
        >
          {pending ? "Creating…" : `Create test cycle in ${umbrella}`}
        </Button>
      </div>
    </Modal>
  );
}

/** Move an existing project into this umbrella, from the umbrella's side. Its library can come along. */
function MoveIntoThisUmbrella({ groupId, umbrella, loose, onClose }: { groupId: string; umbrella: string; loose: LooseProject[]; onClose: () => void }) {
  const [pick, setPick] = useState(loose[0]?.id ?? "");
  const project = loose.find((p) => p.id === pick);
  const [bring, setBring] = useState(true);
  const { pending, error, setError, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`Move a test cycle into ${umbrella}`}>
      <p className="text-sm text-slate-500">It joins {umbrella}&apos;s team, uses its Jira and bug template, and shows in its hub. Its runs and results stay as they are.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {loose.length === 0 ? (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Every test cycle you can move is already in an umbrella. Use New test cycle instead.</p>
      ) : (
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">Test cycle</legend>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {loose.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="move-in" className="accent-accent-600" checked={pick === p.id} onChange={() => setPick(p.id)} />
                <span className="font-mono text-xs font-semibold text-accent-700">{p.key}</span>
                {p.name}
                <span className="text-xs text-slate-500">{plural(p.cases, "case")}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {project && project.cases > 0 && (
        <label className="mt-3 flex items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-slate-800">
          <input type="checkbox" className="mt-0.5 accent-accent-600" checked={bring} onChange={(e) => setBring(e.target.checked)} />
          <span>
            Move its {plural(project.cases, "case")}, suites and shared steps into the {umbrella} case library
            <span className="block text-xs text-slate-500">Same-name cases are matched, not doubled.</span>
          </span>
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={pending || !project}
          onClick={() =>
            run(
              async () => {
                const moved = await setProjectGroup(project!.id, groupId);
                if (!moved.ok || !bring || !project!.cases) return moved;
                return moveCasesIntoUmbrella(groupId, project!.id);
              },
              () => onClose(),
            )
          }
        >
          {pending ? "Moving…" : `Move into ${umbrella}`}
        </Button>
      </div>
    </Modal>
  );
}

/** In a project's settings: keep its own team instead of the umbrella's (for private projects). */
export function KeepSeparateSwitch({
  projectId,
  on,
  umbrella,
  disabled,
}: {
  projectId: string;
  on: boolean;
  umbrella: string;
  disabled?: boolean;
}) {
  const { pending, error, setError, run } = useAction();
  // Flips at once; goes back if the server refuses.
  const [shown, setShown] = useState(on);
  useEffect(() => setShown(on), [on]);
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          className="mt-0.5 size-4 accent-accent-600"
          checked={shown}
          disabled={pending || disabled}
          onChange={(e) => {
            const next = e.target.checked;
            setShown(next);
            run(async () => {
              const r = await setKeepMembersSeparate(projectId, next);
              if (!r.ok) setShown(!next);
              return r;
            });
          }}
        />
        <span>
          <span className="block text-sm font-medium text-slate-900">
            Keep members separate
          </span>
          <span className="block text-xs text-slate-500">
            {shown
              ? `Only the people listed below can see this test cycle. ${umbrella}'s team isn't added.`
              : `Everyone on ${umbrella}'s team can see and test this test cycle. Turn on for a private test cycle.`}
          </span>
        </span>
      </label>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}

/** "Move cases into OKO": pull one test cycle's cases up into the Case library. */
export function MoveCasesButton({
  groupId,
  umbrella,
  projects,
  label,
}: {
  groupId: string;
  umbrella: string;
  projects: { id: string; name: string; cases: number }[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(projects.find((p) => p.cases > 0)?.id ?? "");
  const [done, setDone] = useState<string | null>(null);
  const { pending, error, setError, run } = useAction();
  const pick = projects.find((p) => p.id === from);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        title={`Bring a test cycle's own cases into the ${umbrella} case library`}
      >
        {label ?? `↓ Move cases into ${umbrella}`}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Move cases into ${umbrella}`}
      >
        <p className="text-sm text-slate-500">
          Pulls a test cycle&apos;s own cases, suites and shared steps up into
          {" "}the {umbrella} case library, with their folders. A case whose title the library already
          has is matched instead of copied: the test cycle&apos;s suites switch to
          the library&apos;s case and its copy is archived. Runs keep what they
          ran.
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {done && (
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {done}
          </p>
        )}
        <fieldset className="mt-3 space-y-1">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            From
          </legend>
          {projects.map((p) => (
            <label
              key={p.id}
              className={cx(
                "flex items-center gap-2 text-sm",
                p.cases === 0 && "text-slate-400",
              )}
            >
              <input
                type="radio"
                name="from"
                className="accent-accent-600"
                checked={from === p.id}
                disabled={p.cases === 0}
                onChange={() => setFrom(p.id)}
              />
              {p.name}
              <span className="text-xs text-slate-500">
                {p.cases} {p.cases === 1 ? "case" : "cases"}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            disabled={pending || !pick || pick.cases === 0}
            onClick={() =>
              run(
                () => moveCasesIntoUmbrella(groupId, from),
                (r: { moved: number; matched: number; suites: number }) =>
                  setDone(
                    `Moved ${r.moved} ${r.moved === 1 ? "case" : "cases"}${r.suites ? ` and ${r.suites} ${r.suites === 1 ? "suite" : "suites"}` : ""} into ${umbrella}${r.matched ? `, and matched ${r.matched} the library already had` : ""}.`,
                  ),
              )
            }
          >
            {pending ? "Moving…" : "Move cases"}
          </Button>
          <Button onClick={() => setOpen(false)}>
            {done ? "Close" : "Cancel"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export type UmbrellaCardData = {
  id: string;
  name: string;
  tagline: string;
  shortcuts: Shortcut[];
  /** Pages the editor offers; only for those who may edit the shortcuts. */
  choices: ShortcutChoice[] | null;
  archived: boolean;
  /** Archived umbrellas, for admins: the projects a restore brings back. */
  restore: string[] | null;
  /** A bug bash on now (ver_93). */
  live?: { href: string; endsAt: string } | null;
};

/** An umbrella on the Projects page: enter its hub, or skip straight to a page with one of its shortcuts. */
export function UmbrellaCard({ u, lead, tail, grip, className, ...drop }: { u: UmbrellaCardData; lead?: ReactNode; tail?: ReactNode; /** Makes the top row the drag handle (ver_94). */ grip?: React.HTMLAttributes<HTMLDivElement>; className?: string } & React.HTMLAttributes<HTMLElement>) {
  const [editing, setEditing] = useState(false);
  return (
    <section
      aria-label={`${u.name} umbrella`}
      className={cx("rounded-xl border border-accent-100 bg-accent-50/60 p-4 sm:p-5", u.archived && "opacity-80", className)}
      {...drop}
    >
      <div {...grip} className={cx("flex flex-wrap items-start justify-between gap-3", grip?.className)}>
        <div className="flex items-center gap-3">
          {lead}
          <span className="grid size-10 place-items-center rounded-full bg-surface text-accent-600 ring-1 ring-accent-100">
            <UmbrellaIcon className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              <Link href={`/g/${u.id}`} draggable={false} className="hover:underline">
                {u.name}
              </Link>
              {u.archived && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[11px] font-normal text-slate-600">Archived</span>}
              {u.live && (
                <span className="ml-2 align-middle text-sm font-normal">
                  <LiveBashPill href={u.live.href} endsAt={u.live.endsAt} compact />
                </span>
              )}
            </h2>
            <p className="text-sm text-slate-500">{u.tagline}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {u.choices && !u.archived && !editing && (
            <Button onClick={() => setEditing(true)} aria-expanded={editing}>
              ✎ Edit shortcuts
            </Button>
          )}
          <Link
            href={`/g/${u.id}`}
            draggable={false}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent-600 px-3.5 text-sm font-medium whitespace-nowrap text-white shadow-sm hover:bg-accent-700"
          >
            Open {u.name} →
          </Link>
          {tail}
        </div>
      </div>
      {u.restore && <RestoreUmbrella groupId={u.id} name={u.name} going={u.restore} />}
      {u.shortcuts.length > 0 && !u.archived && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {u.shortcuts.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                draggable={false}
                className="group flex h-full items-center gap-3 rounded-lg border border-slate-200 bg-surface px-3.5 py-3 hover:border-accent-500 hover:shadow-sm"
              >
                <ShortcutIcon
                  icon={s.icon}
                  className="size-5 text-accent-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {s.label}
                  </span>
                  {s.sub && (
                    <span className="block truncate text-xs text-slate-500">
                      {s.sub}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="text-slate-400 group-hover:text-accent-600"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {editing && u.choices && (
        <ShortcutsEditor
          groupId={u.id}
          name={u.name}
          current={u.shortcuts}
          choices={u.choices}
          onDone={() => setEditing(false)}
        />
      )}
    </section>
  );
}

/** An archived umbrella's card, admins only: restore it with the test cycles that went with it, confirmed in place. */
function RestoreUmbrella({ groupId, name, going }: { groupId: string; name: string; going: string[] }) {
  const [asking, setAsking] = useState(false);
  const { pending, error, setError, run } = useAction();
  const n = going.length;
  return (
    <div className="mt-3 space-y-2">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {asking ? (
        <div className="space-y-2 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm">
          <p className="font-semibold text-slate-900">
            Restore {name}
            {n ? ` and its ${plural(n, "test cycle")}` : ""}?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => setUmbrellaArchived(groupId, false), () => setAsking(false))}>
              Yes, restore
            </Button>
            <Button size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setAsking(true)}>
          Restore…
        </Button>
      )}
    </div>
  );
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
