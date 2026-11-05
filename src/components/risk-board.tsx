"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { CharterTemplateInfo } from "@/lib/charter-templates";
import { charterMinutes, defaultAction, LEVEL_WORD, riskLevel, riskScore, type Level, type PlanAction, type RiskLevel } from "@/lib/risk";
import type { RiskCard } from "@/lib/risk-data";
import { moveRisk, planRc, resetRisk } from "@/server/risk";
import { copyRich, tableClip } from "./export-menu";
import { Modal } from "./modal";
import { Button, cx, InfoTip, Select } from "./ui";
import { shortDate } from "@/lib/spelling";
import { StartBashButton } from "./bash-start";
import { useSpelling, useZone } from "./spelling";

const LEVELS: Level[] = [1, 2, 3];
const CELL: Record<RiskLevel, string> = { High: "bg-red-50", Med: "bg-amber-50", Low: "bg-emerald-50/60" };
const CHIP: Record<RiskLevel, string> = { High: "bg-red-100 text-red-800", Med: "bg-amber-100 text-amber-800", Low: "bg-emerald-100 text-emerald-800" };

export function RiskChip({ level }: { level: RiskLevel }) {
  return <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-semibold", CHIP[level])}>{level}</span>;
}

/** The 3×3 board: likelihood up the side, impact along the bottom. Drag or click a card to move it. */
export function RiskBoard({
  homeId,
  release,
  releases = [release],
  cards: start,
  canMove,
  cycles,
  templates,
  canPlan,
  bash,
  bashed = {},
  withCases = true,
  planData,
}: {
  /** Plan this release's names, kinds, personas and open runs. */
  planData?: PlanData;
  homeId: string;
  /** What the board is for, in words: "2.4", or "2.4 + Web 2.4" with several releases. */
  release: string;
  /** The picked releases (ver_161). Plan this release marks its run with the first. */
  releases?: string[];
  cards: RiskCard[];
  canMove: boolean;
  cycles: { id: string; name: string }[];
  templates: CharterTemplateInfo[];
  canPlan: boolean;
  /** Start a bug bash from the board, for people who can start runs. */
  /** The project to start it in; the box gets its own data when it opens. */
  bash?: string;
  /** When each requirement was last bashed, and what its area found. */
  bashed?: Record<string, { at: string; bugs: number }>;
  /** False when the umbrella doesn't use Test cases: no "No tests" counts or tags. */
  withCases?: boolean;
}) {
  const router = useRouter();
  const spelling = useSpelling();
  const zone = useZone();
  const [cards, setCards] = useState(start);
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);
  const [, startTransition] = useTransition();
  const say = (s: string) => {
    setNote(s);
    setTimeout(() => setNote(null), 5000);
  };
  const noTests = cards.filter((c) => !c.cases).length;

  const move = (key: string, likelihood: Level, impact: Level) => {
    const before = cards;
    setCards((all) => all.map((c) => (c.key === key ? { ...c, likelihood, impact, level: riskLevel(likelihood, impact), moved: { by: "you", at: new Date().toISOString() } } : c)));
    startTransition(async () => {
      const res = await moveRisk(homeId, before.find((c) => c.key === key)?.release || releases[0], key, likelihood, impact);
      if (!res.ok) {
        setCards(before);
        say(res.error);
      } else router.refresh();
    });
  };
  const reset = (key: string) => {
    startTransition(async () => {
      const res = await resetRisk(homeId, cards.find((c) => c.key === key)?.release || releases[0], key);
      if (!res.ok) return say(res.error);
      setCards((all) => all.map((c) => (c.key === key ? { ...c, ...c.guess, level: riskLevel(c.guess.likelihood, c.guess.impact), moved: null } : c)));
      router.refresh();
    });
  };
  const copy = async () => {
    const sorted = [...cards].sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact));
    const { html, text } = tableClip(`Risk board · ${release}`, [withCases ? `${cards.length} requirements · ${noTests} with no tests` : `${cards.length} requirements`], [
      ["Requirement", "Title", "Risk", "Likely to break", "Would hurt", "Cases", "Why"],
      ...sorted.map((c) => [c.key, c.title, c.level, LEVEL_WORD[c.likelihood], LEVEL_WORD[c.impact], c.cases, c.moved ? `Moved by ${c.moved.by}` : c.reasons.join("; ")]),
    ]);
    try {
      await copyRich(html, text);
      say("Copied. Paste it into Confluence or an email.");
    } catch {
      say("Couldn't copy here.");
    }
  };
  const openCard = cards.find((c) => c.key === open) ?? null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {cards.length} {cards.length === 1 ? "requirement" : "requirements"}
          {withCases && ` · ${noTests} with no tests`}
          {canMove && <span className="text-slate-500"> · Drag a card, or click it, to move it</span>}
        </p>
        <div className="flex items-center gap-2">
          {note && (
            <span role="status" className="text-xs text-emerald-700">
              {note}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={copy}>
            Copy for Confluence
          </Button>
          {canPlan && (
            <Button variant="secondary" size="sm" onClick={() => setPlan(true)} disabled={!cards.length}>
              Plan this release
            </Button>
          )}
          {bash && cards.length > 0 && (
            <StartBashButton
              projectId={bash}
              size="sm"
              variant="primary"
              label={canPlan ? "Start a bug bash" : "Start a bug bash on these"}
              preset={{
                name: `${release} risk bash`,
                // Without Test runs this stands in for Plan this release, with the high-risk cards as its areas.
                picks: [...cards]
                  .filter((c) => canPlan || c.level === "High" || !cards.some((x) => x.level === "High"))
                  .sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact))
                  .map((c) => ({ key: c.key, title: c.title, url: c.url ?? "", level: c.level, cases: c.cases })),
              }}
            />
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex w-6 items-center justify-center">
          <span className="-rotate-90 text-xs font-medium whitespace-nowrap text-slate-500">How likely to break →</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-3 gap-1.5" role="grid" aria-label={`Risk board for ${release}`}>
            {[3, 2, 1].map((l) =>
              LEVELS.map((i) => {
                const here = cards.filter((c) => c.likelihood === l && c.impact === i);
                const lvl = riskLevel(l, i);
                return (
                  <div
                    key={`${l}-${i}`}
                    role="gridcell"
                    aria-label={`${LEVEL_WORD[l as Level]} likelihood, ${LEVEL_WORD[i]} impact: ${here.length}`}
                    className={cx("min-h-28 rounded-md p-1.5", CELL[lvl], drag && "ring-1 ring-slate-300 ring-inset")}
                    onDragOver={(e) => canMove && drag && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (drag) move(drag, l as Level, i);
                      setDrag(null);
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      {here.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          draggable={canMove}
                          data-howto="risk-card"
                          onDragStart={() => setDrag(c.key)}
                          onDragEnd={() => setDrag(null)}
                          onClick={() => setOpen(c.key)}
                          className={cx("rounded-md border bg-surface px-2 py-1 text-left text-xs shadow-sm hover:border-accent-400", open === c.key ? "border-accent-600" : "border-slate-200")}
                          data-testid="risk-card"
                        >
                          <span className="font-mono text-[11px] text-slate-500">{c.key}</span>
                          {!c.cases && withCases && <span className="ml-1 rounded bg-slate-800 px-1 text-[10px] font-medium text-white">No tests</span>}
                          {c.moved && <span className="ml-1 text-[10px] text-slate-400" title={`Moved by ${c.moved.by}`}>✋</span>}
                          <span className="block truncate text-slate-800">{c.title || c.key}</span>
                          {bashed[c.key] && (
                            <span className="block text-[10px] text-rose-700">
                              🐞 Bashed {shortDate(new Date(bashed[c.key].at), spelling, zone)} · {bashed[c.key].bugs} {bashed[c.key].bugs === 1 ? "bug" : "bugs"}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }),
            )}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1.5 text-center text-xs font-medium text-slate-500">
            {LEVELS.map((i) => (
              <span key={i}>{LEVEL_WORD[i]} impact</span>
            ))}
          </div>
          <p className="mt-0.5 text-center text-xs text-slate-500">How much it would hurt →</p>
        </div>
      </div>

      <Modal open={!!openCard} onClose={() => setOpen(null)} title={openCard ? `${openCard.key} · ${openCard.title}` : ""}>
        {openCard && <CardDetail c={openCard} withCases={withCases} canMove={canMove} onMove={(l, i) => move(openCard.key, l, i)} onReset={() => reset(openCard.key)} />}
      </Modal>
      <Modal open={plan && !!planData} onClose={() => setPlan(false)} title={`Plan a test run for ${release}`} wide>
        {plan && planData && <PlanRc homeId={homeId} release={release} releases={releases} cards={cards} cycles={cycles} templates={templates} data={planData} onClose={() => setPlan(false)} />}
      </Modal>
    </div>
  );
}

function CardDetail({ c, withCases, canMove, onMove, onReset }: { c: RiskCard; withCases: boolean; canMove: boolean; onMove: (l: Level, i: Level) => void; onReset: () => void }) {
  return (
    <div className="space-y-3 text-sm" data-glossary-source={`Risk board · ${c.key}`}>
      <p className="flex flex-wrap items-center gap-2">
        <RiskChip level={c.level} />
        <span className="text-slate-600">
          {c.type || "Requirement"} · {c.status || "No status"}
          {withCases && ` · ${c.cases ? `${c.cases} ${c.cases === 1 ? "case" : "cases"}` : "no tests"}`}
          {c.pastBugs ? ` · ${c.pastBugs} past ${c.pastBugs === 1 ? "bug" : "bugs"}` : ""}
        </span>
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
            Open in Jira ↗
          </a>
        )}
      </p>
      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
          Flaw Patrol&apos;s first guess: {LEVEL_WORD[c.guess.likelihood]} likelihood, {LEVEL_WORD[c.guess.impact]} impact
          <InfoTip text="From the Jira priority, story points, bugs found by its cases before, failing cases, and whether it has any tests." />
        </p>
        <ul className="list-disc pl-5 text-slate-700">
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      {c.moved && <p className="text-xs text-slate-500">Moved by {c.moved.by}.</p>}
      {canMove && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">
            How likely to break
            <Select className="mt-1 block" value={c.likelihood} onChange={(e) => onMove(Number(e.target.value) as Level, c.impact)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_WORD[l]}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            How much it would hurt
            <Select className="mt-1 block" value={c.impact} onChange={(e) => onMove(c.likelihood, Number(e.target.value) as Level)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_WORD[l]}
                </option>
              ))}
            </Select>
          </label>
          {c.moved && (
            <Button variant="secondary" size="sm" onClick={onReset}>
              Back to the first guess
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

type Pick = { action: PlanAction; minutes: number; template: string; persona: string };

/** What Plan this release needs besides the cards. */
export type PlanData = {
  homeKey: string;
  kinds: { id: string; name: string }[];
  personas: { id: string; name: string; emoji: string }[];
  /** Open runs to add to, this release's first. */
  openRuns: { id: string; label: string }[];
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Radio pills for one labeled question in a requirement card. */
function Pills<T extends string | number>({ name, value, options, onChange }: { name: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <label key={String(v)} className={cx("cursor-pointer rounded-full border px-2.5 py-0.5 text-xs", value === v ? "border-accent-600 bg-accent-50 font-medium text-accent-800" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
          <input type="radio" className="sr-only" name={name} checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </span>
  );
}

function Question({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7.5rem_1fr] sm:items-center">
      <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      {children}
    </div>
  );
}

function PlanRc({ homeId, release, releases, cards, cycles, templates, data, onClose }: { homeId: string; release: string; releases: string[]; cards: RiskCard[]; cycles: { id: string; name: string }[]; templates: CharterTemplateInfo[]; data: PlanData; onClose: () => void }) {
  const router = useRouter();
  const sorted = useMemo(() => [...cards].sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact)), [cards]);
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(sorted.map((c) => [c.key, { action: defaultAction(c.level, c.cases), minutes: charterMinutes(c.level), template: "", persona: "" }])));
  const [into, setInto] = useState<"new" | "add">("new");
  const [runId, setRunId] = useState(data.openRuns[0]?.id ?? "");
  const [name, setName] = useState(`${release} · riskiest first`);
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [kind, setKind] = useState(data.kinds.some((k) => k.id === "rc") ? "rc" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, p: Partial<Pick>) => setPicks((all) => ({ ...all, [key]: { ...all[key], ...p } }));
  const run = sorted.filter((c) => picks[c.key]?.action === "run");
  const explore = sorted.filter((c) => picks[c.key]?.action === "charter");
  const skip = sorted.filter((c) => picks[c.key]?.action === "skip");
  const runCases = run.reduce((n, c) => n + c.cases, 0);
  const items = runCases + explore.length;
  const adding = into === "add";
  const target = data.openRuns.find((r) => r.id === runId);
  const cycleName = cycles.find((c) => c.id === cycleId)?.name ?? "";
  const kindName = data.kinds.find((k) => k.id === kind)?.name;
  const tplName = (id: string) => templates.find((t) => t.id === id)?.name;

  const make = async () => {
    setBusy(true);
    setError(null);
    const res = await planRc(homeId, {
      release: releases[0] ?? release,
      releases: releases.length > 1 ? releases : undefined,
      cycleId,
      name: name.trim() || undefined,
      kind,
      runId: adding ? runId : null,
      picks: sorted.map((c) => ({ key: c.key, action: picks[c.key].action, minutes: picks[c.key].minutes, template: picks[c.key].template || null, persona: picks[c.key].persona || null })),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.push(res.href);
  };

  return (
    <div className="space-y-3 text-sm" data-testid="plan-release">
      <p className="text-slate-600">
        This builds <b>one test run</b> for release <b>{release}</b>. Its requirements are listed riskiest first. For each one, choose what to do. Nothing is created until you press the button at the bottom.
      </p>
      <div className="max-h-[46vh] space-y-2.5 overflow-auto pr-1">
        {sorted.map((c) => {
          const p = picks[c.key];
          const id = c.key.replace(/\W/g, "");
          const persona = data.personas.find((x) => x.id === p.persona);
          return (
            <div key={c.key} className={cx("space-y-2 rounded-lg border border-slate-200 p-3", p.action === "skip" && "bg-slate-50 opacity-75")} data-testid={`plan-${c.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{c.key}</span>
                <span className="min-w-0 flex-1 font-medium text-slate-900">{c.title}</span>
                <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-semibold", CHIP[c.level])}>{c.level} risk</span>
                <span className="text-xs text-slate-500">{c.cases ? plural(c.cases, "test case") : "No test cases yet"}</span>
              </div>
              <Question label="What to do">
                <Pills
                  name={`a${id}`}
                  value={p.action}
                  onChange={(v) => set(c.key, { action: v })}
                  options={[...(c.cases ? ([["run", `Run its ${plural(c.cases, "case")}`]] as [PlanAction, string][]) : []), ["charter", "Explore it with a charter"], ["skip", "Leave it out"]]}
                />
              </Question>
              {!c.cases && (
                <p className="text-xs text-slate-500">
                  Would rather have step-by-step cases?{" "}
                  <a href={`/p/${data.homeKey}/stories?release=${encodeURIComponent(c.release || release)}&open=${encodeURIComponent(c.key)}`} className="font-medium text-accent-700 hover:underline">
                    Write test cases instead
                  </a>
                </p>
              )}
              {p.action === "charter" && (
                <div className="space-y-2 border-l-2 border-accent-200 pl-3">
                  <Question label="How long">
                    <Pills name={`m${id}`} value={p.minutes} onChange={(v) => set(c.key, { minutes: v })} options={[15, 30, 45, 60, 90].map((m) => [m, `${m} min`] as [number, string])} />
                  </Question>
                  <Question label="Start from" tip="A tour or checklist adds ready-made prompts to the charter, such as “Lose the network mid-save”.">
                    <Select aria-label={`Start ${c.key} from`} className="h-8 text-xs" value={p.template} onChange={(e) => set(c.key, { template: e.target.value })}>
                      <option value="">Blank (just the Jira title)</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.short}
                        </option>
                      ))}
                    </Select>
                  </Question>
                  {data.personas.length > 0 && (
                    <Question label="Test persona">
                      <Pills name={`p${id}`} value={p.persona} onChange={(v) => set(c.key, { persona: v })} options={[["", "Nobody in particular"], ...data.personas.map((x) => [x.id, `${x.emoji} ${x.name}`] as [string, string])]} />
                    </Question>
                  )}
                  <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    The charter will say: <b>Explore</b> {c.title || c.key}
                    {p.template && tplName(p.template) && (
                      <>
                        {" "}
                        <b>using the</b> {tplName(p.template)}
                      </>
                    )}{" "}
                    · <b>to discover</b> what could break before release
                    {persona && (
                      <>
                        {" "}
                        · <b>as</b> {persona.emoji} {persona.name}
                      </>
                    )}{" "}
                    · {p.minutes} min
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Question label="Put them in">
        <Pills
          name="plan-into"
          value={into}
          onChange={setInto}
          options={[
            ["new", "A new test run"],
            ...(data.openRuns.length ? ([["add", "A run in progress"]] as ["add", string][]) : []),
          ]}
        />
      </Question>
      {adding ? (
        <label className="block text-xs font-medium text-slate-600">
          Which run
          <Select className="mt-1 block w-full" value={runId} onChange={(e) => setRunId(e.target.value)}>
            {data.openRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <span className="mt-1 block font-normal text-slate-500">Only runs that are still open. Runs for {release} are listed first. Cases already in the run are not added twice.</span>
        </label>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-600">
            Run name
            <input className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-surface px-2.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Test cycle
            <Select className="mt-1 block w-full" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            <span className="flex items-center gap-1">
              Kind <InfoTip text="Release candidate runs count toward this release's RC status. Change it if this is only a practice run." />
            </span>
            <Select className="mt-1 block w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
              {data.kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
              <option value="">No kind</option>
            </Select>
          </label>
        </div>
      )}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950" aria-live="polite" data-testid="plan-summary">
        <p className="mb-1 text-xs font-semibold tracking-wide uppercase">What you&apos;ll get</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {items ? (
            <>
              <li>
                {adding ? (
                  <>
                    Added to <b>{target?.label.split(" · ")[0]}</b>, which is already in progress. Its existing results stay as they are.
                  </>
                ) : (
                  <>
                    One new test run, <b>{name.trim() || "Untitled run"}</b>
                    {kindName && (
                      <>
                        , kind <b>{kindName}</b>
                      </>
                    )}
                    , in <b>{cycleName}</b>.
                  </>
                )}
              </li>
              {runCases > 0 && (
                <li>
                  {plural(runCases, "existing test case")} from {run.map((c) => c.key).join(", ")}.
                </li>
              )}
              {explore.length > 0 && (
                <li>
                  {plural(explore.length, "new charter")} for {explore.map((c) => c.key).join(", ")}, saved in <b>Charters</b> and linked to the requirement.
                </li>
              )}
              {skip.length > 0 && <li>{skip.map((c) => c.key).join(", ")} left out.</li>}
              <li>{adding ? "New items show an Added tag in the run, and nobody is assigned yet." : "Nobody is assigned yet. You can assign people on the run page."}</li>
            </>
          ) : (
            <li>
              Nothing to run yet. Choose <b>Run its cases</b> or <b>Explore it with a charter</b> for at least one requirement.
            </li>
          )}
        </ul>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={make} disabled={busy || !items || (adding && !runId)}>
          {busy ? (adding ? "Adding…" : "Creating…") : adding ? (items ? `Add ${plural(items, "item")} to the run` : "Add to the run") : items ? `Create test run (${plural(items, "item")})` : "Create test run"}
        </Button>
      </div>
    </div>
  );
}
