"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { CharterTemplateInfo } from "@/lib/charter-templates";
import { charterMinutes, defaultAction, LEVEL_WORD, riskLevel, riskScore, type Level, type PlanAction, type RiskLevel } from "@/lib/risk";
import type { RiskCard } from "@/lib/risk-data";
import { moveRisk, planRc, resetRisk } from "@/server/risk";
import { copyRich, tableClip } from "./export-menu";
import { Modal } from "./modal";
import { Button, Card, cx, InfoTip, Select } from "./ui";
import type { StartBoxData } from "@/lib/bash-data";
import { shortDate } from "@/lib/spelling";
import { StartBashButton } from "./bash-start";
import { useSpelling } from "./spelling";

const LEVELS: Level[] = [1, 2, 3];
const CELL: Record<RiskLevel, string> = { High: "bg-red-50", Med: "bg-amber-50", Low: "bg-emerald-50/60" };
const CHIP: Record<RiskLevel, string> = { High: "bg-red-100 text-red-800", Med: "bg-amber-100 text-amber-800", Low: "bg-emerald-100 text-emerald-800" };

export function RiskChip({ level }: { level: RiskLevel }) {
  return <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-semibold", CHIP[level])}>{level}</span>;
}

/** The 3×3 board (ver_93): likelihood up the side, impact along the bottom. Drag or click a card to move it. */
export function RiskBoard({
  homeId,
  release,
  cards: start,
  canMove,
  cycles,
  templates,
  canPlan,
  bash,
  bashed = {},
}: {
  homeId: string;
  release: string;
  cards: RiskCard[];
  canMove: boolean;
  cycles: { id: string; name: string }[];
  templates: CharterTemplateInfo[];
  canPlan: boolean;
  /** Start a bug bash from the board (ver_96), for people who can start runs. */
  bash?: StartBoxData;
  /** When each requirement was last bashed, and what its area found. */
  bashed?: Record<string, { at: string; bugs: number }>;
}) {
  const router = useRouter();
  const spelling = useSpelling();
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
      const res = await moveRisk(homeId, release, key, likelihood, impact);
      if (!res.ok) {
        setCards(before);
        say(res.error);
      } else router.refresh();
    });
  };
  const reset = (key: string) => {
    startTransition(async () => {
      const res = await resetRisk(homeId, release, key);
      if (!res.ok) return say(res.error);
      setCards((all) => all.map((c) => (c.key === key ? { ...c, ...c.guess, level: riskLevel(c.guess.likelihood, c.guess.impact), moved: null } : c)));
      router.refresh();
    });
  };
  const copy = async () => {
    const sorted = [...cards].sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact));
    const { html, text } = tableClip(`Risk board · ${release}`, [`${cards.length} requirements · ${noTests} with no tests`], [
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
          {cards.length} {cards.length === 1 ? "requirement" : "requirements"} · {noTests} with no tests
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
              data={bash}
              size="sm"
              variant="primary"
              label="Start a bug bash"
              preset={{
                name: `${release} risk bash`,
                picks: [...cards].sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact)).map((c) => ({ key: c.key, title: c.title, url: c.url ?? "", level: c.level, cases: c.cases })),
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
                          onDragStart={() => setDrag(c.key)}
                          onDragEnd={() => setDrag(null)}
                          onClick={() => setOpen(c.key)}
                          className={cx("rounded-md border bg-surface px-2 py-1 text-left text-xs shadow-sm hover:border-accent-400", open === c.key ? "border-accent-600" : "border-slate-200")}
                          data-testid="risk-card"
                        >
                          <span className="font-mono text-[11px] text-slate-500">{c.key}</span>
                          {!c.cases && <span className="ml-1 rounded bg-slate-800 px-1 text-[10px] font-medium text-white">No tests</span>}
                          {c.moved && <span className="ml-1 text-[10px] text-slate-400" title={`Moved by ${c.moved.by}`}>✋</span>}
                          <span className="block truncate text-slate-800">{c.title || c.key}</span>
                          {bashed[c.key] && (
                            <span className="block text-[10px] text-rose-700">
                              🐞 Bashed {shortDate(new Date(bashed[c.key].at), spelling)} · {bashed[c.key].bugs} {bashed[c.key].bugs === 1 ? "bug" : "bugs"}
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
        {openCard && <CardDetail c={openCard} canMove={canMove} onMove={(l, i) => move(openCard.key, l, i)} onReset={() => reset(openCard.key)} />}
      </Modal>
      <Modal open={plan} onClose={() => setPlan(false)} title={`Plan ${release}, riskiest first`} wide>
        {plan && <PlanRc homeId={homeId} release={release} cards={cards} cycles={cycles} templates={templates} onClose={() => setPlan(false)} />}
      </Modal>
    </div>
  );
}

function CardDetail({ c, canMove, onMove, onReset }: { c: RiskCard; canMove: boolean; onMove: (l: Level, i: Level) => void; onReset: () => void }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <RiskChip level={c.level} />
        <span className="text-slate-600">
          {c.type || "Requirement"} · {c.status || "No status"} · {c.cases ? `${c.cases} ${c.cases === 1 ? "case" : "cases"}` : "no tests"}
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

type Pick = { action: PlanAction; minutes: number; template: string };

function PlanRc({ homeId, release, cards, cycles, templates, onClose }: { homeId: string; release: string; cards: RiskCard[]; cycles: { id: string; name: string }[]; templates: CharterTemplateInfo[]; onClose: () => void }) {
  const router = useRouter();
  const sorted = useMemo(() => [...cards].sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact)), [cards]);
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(sorted.map((c) => [c.key, { action: defaultAction(c.level, c.cases), minutes: charterMinutes(c.level), template: "" }])));
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, p: Partial<Pick>) => setPicks((all) => ({ ...all, [key]: { ...all[key], ...p } }));
  const runCases = sorted.filter((c) => picks[c.key]?.action === "run").reduce((n, c) => n + c.cases, 0);
  const charters = sorted.filter((c) => picks[c.key]?.action === "charter").length;
  const cycleName = cycles.find((c) => c.id === cycleId)?.name ?? "";

  const make = async () => {
    setBusy(true);
    setError(null);
    const res = await planRc(homeId, { release, cycleId, picks: sorted.map((c) => ({ key: c.key, action: picks[c.key].action, minutes: picks[c.key].minutes, template: picks[c.key].template || null })) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.push(res.href);
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Requirements with cases go into one run. Ones with none can get a new charter, filled in from the Jira summary, so someone explores them instead.</p>
      <Card className="max-h-[50vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Requirement</th>
              <th className="px-2 py-1.5 font-medium">Risk</th>
              <th className="px-2 py-1.5 font-medium">Has</th>
              <th className="px-3 py-1.5 font-medium">Plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((c) => {
              const p = picks[c.key];
              return (
                <tr key={c.key}>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs text-slate-500">{c.key}</span> {c.title}
                  </td>
                  <td className="px-2 py-1.5">
                    <RiskChip level={c.level} />
                  </td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap text-slate-600">{c.cases ? `${c.cases} ${c.cases === 1 ? "case" : "cases"}` : "Nothing"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Select aria-label={`Plan for ${c.key}`} value={p.action} onChange={(e) => set(c.key, { action: e.target.value as PlanAction })}>
                        {c.cases > 0 && <option value="run">Run its {c.cases} {c.cases === 1 ? "case" : "cases"}</option>}
                        <option value="charter">New charter</option>
                        <option value="skip">Skip</option>
                      </Select>
                      {p.action === "charter" && (
                        <>
                          <Select aria-label="Time limit" value={p.minutes} onChange={(e) => set(c.key, { minutes: Number(e.target.value) })}>
                            {[15, 30, 45, 60, 90].map((m) => (
                              <option key={m} value={m}>
                                {m} min
                              </option>
                            ))}
                          </Select>
                          <Select aria-label="Tour or checklist" value={p.template} onChange={(e) => set(c.key, { template: e.target.value })}>
                            <option value="">Blank charter</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </Select>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {cycles.length > 1 && (
        <label className="block text-xs font-medium text-slate-600">
          Test cycle for the run
          <Select className="mt-1 block" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <p className="text-slate-700">
        {charters ? `Makes ${charters} ${charters === 1 ? "charter" : "charters"} and adds ` : "Adds "}
        {runCases} {runCases === 1 ? "case" : "cases"}
        {charters ? ` + ${charters} ${charters === 1 ? "charter" : "charters"}` : ""} to one test run in {release}
        {cycleName ? ` · ${cycleName}` : ""}.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={make} disabled={busy || (!runCases && !charters)}>
          {busy ? "Making the run…" : "Make the run"}
        </Button>
      </div>
    </div>
  );
}
