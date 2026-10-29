"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { GROUP_LABEL, GROUP_TIP, type CharterTemplateInfo, type TemplateGroup } from "@/lib/charter-templates";
import { TIME_BOXES } from "@/lib/charter";
import { deleteCharterTemplate, saveCharterTemplate } from "@/server/charters";
import { Modal } from "./modal";
import { useSpell } from "./spelling";
import { Button, Card, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

/** New charter ▾ (ver_93): write your own, or start from a tour or checklist. */
export function NewCharterMenu({ projectKey, teamCount }: { projectKey: string; teamCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="primary" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget) && setOpen(false)}>
        New charter <span aria-hidden className="ml-1 text-xs">▾</span>
      </Button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-surface p-1 shadow-lg">
          <Link role="menuitem" href={`/p/${projectKey}/cases/new?charter=1`} className="block rounded-md px-3 py-2 hover:bg-slate-50">
            <span className="block text-sm font-medium text-slate-900">Blank charter</span>
            <span className="block text-xs text-slate-500">Write your own mission</span>
          </Link>
          <Link role="menuitem" href={`/p/${projectKey}/charters/new`} className="block rounded-md px-3 py-2 hover:bg-slate-50">
            <span className="block text-sm font-medium text-slate-900">From a tour or checklist…</span>
            <span className="block text-xs text-slate-500">12 ready-made{teamCount ? `, plus ${teamCount} of your team's own` : ", plus your team's own"}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * The gallery (ver_93): pick a tour or checklist, see the charter it makes, name the area,
 * and Use this charter opens the charter form filled in, ready to save.
 */
export function TemplateGallery({
  projectId,
  projectKey,
  templates: given,
  personas,
  canManage,
}: {
  projectId: string;
  projectKey: string;
  templates: CharterTemplateInfo[];
  personas: { id: string; name: string; emoji: string }[];
  canManage: boolean;
}) {
  // Built-in tours and checklists follow the reader's US/UK English; the team's own stay as written.
  const sp = useSpell();
  const templates = useMemo(() => given.map((t) => (t.group === "team" ? t : { ...t, short: sp(t.short), tip: sp(t.tip), with: sp(t.with), discover: sp(t.discover), prompts: t.prompts.map(sp) })), [given, sp]);
  const router = useRouter();
  const [show, setShow] = useState<"all" | TemplateGroup>("all");
  const [cur, setCur] = useState(templates.find((t) => t.id === "saboteur")?.id ?? templates[0]?.id);
  const t = templates.find((x) => x.id === cur);
  const [area, setArea] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(t?.minutes ?? 30);
  const [persona, setPersona] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (id: string) => {
    const n = templates.find((x) => x.id === id)!;
    setCur(id);
    setMinutes(n.minutes);
    setTitle("");
  };
  const groups = (["tour", "list", "team"] as const).filter((g) => show === "all" || show === g);
  const name = title || (t ? `${t.name}: ${area || ""}`.trim().replace(/:$/, "") : "");
  const use = () => {
    if (!t) return;
    const q = new URLSearchParams({ charter: "1", template: t.id, title: name, explore: area, minutes: String(minutes), ...(persona && { persona }) });
    router.push(`/p/${projectKey}/cases/new?${q}`);
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
          {(["all", "tour", "list", "team"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={show === g}
              onClick={() => setShow(g)}
              className={cx("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset", show === g ? "bg-accent-600 text-white ring-accent-600" : "bg-surface text-slate-700 ring-slate-200 hover:bg-slate-50")}
            >
              {g === "all" ? "All" : GROUP_LABEL[g]}
            </button>
          ))}
        </div>
        {groups.map((g) => {
          const list = templates.filter((x) => x.group === g);
          return (
            <section key={g} className="mb-5" aria-label={GROUP_LABEL[g]}>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {GROUP_LABEL[g]} <InfoTip text={GROUP_TIP[g]} />
              </h2>
              {list.length ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      title={x.tip}
                      aria-pressed={x.id === cur}
                      onClick={() => pick(x.id)}
                      className={cx("rounded-lg border px-3 py-2 text-left", x.id === cur ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-slate-200 bg-surface hover:border-slate-300")}
                    >
                      {/* The plain line leads; the tour's name is small (ver_94). */}
                      <b className="block text-sm font-medium text-slate-900">{x.short}</b>
                      <span className="block text-[11px] text-slate-500">{x.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                  None yet. {canManage ? "Open any charter and press Save as template to add one here." : "A lead or admin can save any charter as a template."}
                </p>
              )}
            </section>
          );
        })}
      </div>
      {t && (
        <Card className="h-fit space-y-3 p-4 lg:sticky lg:top-4" aria-label="Charter it makes">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Charter it makes</p>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <Field label="Area to explore" htmlFor="tpl-area" hint="The one thing a tour can't know">
            <Input id="tpl-area" autoFocus value={area} onChange={(e) => setArea(e.target.value)} placeholder="Checkout" />
          </Field>
          <Field label="Title" htmlFor="tpl-title">
            <Input id="tpl-title" value={name} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <p className="text-sm text-slate-700">
            Explore {area ? <b>{area}</b> : <span className="rounded bg-amber-50 px-1 text-amber-800 ring-1 ring-amber-200">which area?</span>} with {t.with} to discover {t.discover}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Field label="Time limit" htmlFor="tpl-min">
              <Select id="tpl-min" className="w-auto" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[...new Set([...TIME_BOXES, t.minutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Persona" htmlFor="tpl-persona">
              <Select id="tpl-persona" className="w-auto" value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="">None</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600">Prompts ({t.prompts.length})</p>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {t.prompts.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden className="text-slate-400">☐</span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-slate-500">Ticked off during the session, so the debrief shows what got covered.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={use} disabled={!area.trim()}>
              Use this charter
            </Button>
            <Link href={`/p/${projectKey}/charters`} className="inline-flex items-center rounded-md px-3 text-sm text-slate-700 hover:bg-slate-50">
              Cancel
            </Link>
            {t.group === "team" && canManage && (
              <Button
                variant="ghost"
                className="ml-auto text-red-700"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Delete the ${t.name} template? Charters made from it stay.`)) return;
                  start(async () => {
                    const r = await deleteCharterTemplate(projectId, t.id.replace(/^team:/, ""));
                    if (!r.ok) return setError(r.error);
                    router.refresh();
                  });
                }}
              >
                Delete template
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Save as template (ver_93), on a charter's page: leads and admins. */
export function SaveAsTemplate({ projectId, charter, title }: { projectId: string; title: string; charter: { with: string; discover: string; minutes: number; prompts: string[]; explore: string } }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title.replace(/:.*$/, "").slice(0, 120));
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blankArea = useMemo(() => !charter.with && !charter.discover, [charter]);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Save as template
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Save as template">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Save as template</h2>
          <p className="text-sm text-slate-600">It shows in the gallery under Your team&apos;s, for everyone in this umbrella. The area is left blank for whoever uses it.</p>
          {blankArea && <p className="text-xs text-amber-800">This charter has no “with” or “to discover” yet, so the template will only carry the time limit and prompts.</p>}
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {saved ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
              ✓ Saved. Find it in New charter → From a tour or checklist.
            </p>
          ) : (
            <>
              <Field label="Name" htmlFor="tpl-name">
                <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="One line on the card" htmlFor="tpl-desc">
                <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it's for" />
              </Field>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{saved ? "Close" : "Cancel"}</Button>
            {!saved && (
              <Button
                variant="primary"
                disabled={pending || !name.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await saveCharterTemplate(projectId, { name, description, with: charter.with, discover: charter.discover, minutes: charter.minutes, prompts: charter.prompts });
                    if (!r.ok) return setError(r.error);
                    setSaved(true);
                  })
                }
              >
                Save template
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
