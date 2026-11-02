"use client";

import { keyFromName } from "@/lib/cycle-key";
import { forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import { LiveBashPill } from "./bash";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Shortcut, ShortcutIcon as IconName } from "@/lib/umbrella";
import { createUmbrella, makeUmbrella, moveCasesIntoUmbrella, setKeepMembersSeparate, setShortcuts, setUmbrellaArchived } from "@/server/umbrella";
import { setProjectGroup } from "@/server/groups";
import { ToolPicker } from "./tools";
import { TOOL_IDS, type ToolId } from "@/lib/tools";
import type { GroupChoice } from "./group-dialogs";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Input, Textarea } from "./ui";
import { UmbrellaIcon } from "./umbrella-nav";
import { useAction, plural } from "./umbrella-action";

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

/** A key from a name: "Oko Unity" → "OU", "OKO" → "OKO". */
export { keyFromName };

/** One new project row in the New umbrella box: its platform, and its name once someone types their own. */
type NewRow = { id: number; platform: string; name: string | null };

/** "OKO Web RC23": the umbrella, the platform, then the release, skipping whichever is blank. */
const autoName = (umbrella: string, platform: string, rc: string) => [umbrella.trim(), platform.trim(), rc.trim()].filter(Boolean).join(" ");

/**
 * "New umbrella" on the Projects page, for everyone but Viewers. It's the only way to
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
  // What will you use?: Everything unless picked otherwise. Test cycles only come up with Test runs.
  const [tools, setTools] = useState<ToolId[]>([...TOOL_IDS]);
  const cyclesToo = tools.includes("runs");
  // Only projects outside any umbrella can move in; projects in an old-style group can too.
  const list = choices.filter((c) => c.canMove && !c.archived && !c.inUmbrella);
  const shownKey = key ?? keyFromName(name);
  const anyCases = list.some((c) => ticked.has(c.id) && (c.cases ?? 0) + (c.suites ?? 0) > 0);
  const umbrella = name.trim() || "the umbrella";
  const rowName = (r: NewRow) => r.name ?? (r.platform.trim() ? autoName(name, r.platform, rc) : "");
  const making = cyclesToo ? rows.filter((r) => rowName(r).trim()) : [];
  const setRow = (id: number, patch: Partial<NewRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const moving = cyclesToo ? ticked : new Set<string>();
  const summary = [making.length && plural(making.length, "new test cycle"), moving.size && `${moving.size} moved in`].filter(Boolean).join(" and ");
  return (
    <>
      {/* A small link on the home page of someone waiting to join a team. */}
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
          An umbrella holds one product&apos;s testing, Jira settings and team in one place. You pick the tools it uses, like test cases and runs, or just bug bashes and a risk board.
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
        <ToolPicker on={tools} onChange={setTools} />
        <div className="mt-3">
          <Field label="Description (optional)" htmlFor="u-desc">
            <Textarea id="u-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        {cyclesToo && (
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
          <p className="text-xs text-slate-500">Test cycles are where you run tests, one for each round of testing, such as one release on one platform.</p>
        </fieldset>
        )}

        {cyclesToo && list.length > 0 && (
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
                    projectIds: [...moving],
                    moveCases: bring && anyCases && cyclesToo,
                    tools,
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
  // Forgiving search: exact matches in their sections, close ones under their own label.
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
  /** The tools it uses, when not every one, like "Bug bashes · Risk board". */
  tools?: string;
  shortcuts: Shortcut[];
  /** Pages the editor offers; only for those who may edit the shortcuts. */
  choices: ShortcutChoice[] | null;
  archived: boolean;
  /** Archived umbrellas, for admins: the projects a restore brings back. */
  restore: string[] | null;
  /** A bug bash on now. */
  live?: { href: string; endsAt: string } | null;
};

/** An umbrella on the Projects page: enter its hub, or skip straight to a page with one of its shortcuts. */
export function UmbrellaCard({ u, lead, tail, grip, className, ...drop }: { u: UmbrellaCardData; lead?: ReactNode; tail?: ReactNode; /** Makes the top row the drag handle. */ grip?: React.HTMLAttributes<HTMLDivElement>; className?: string } & React.HTMLAttributes<HTMLElement>) {
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
            {u.tools && (
              <p className="mt-0.5 text-xs font-medium text-accent-700" data-testid="umbrella-tools">
                {u.tools}
              </p>
            )}
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
