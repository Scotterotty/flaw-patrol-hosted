"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ErrorText } from "./error-text";
import { Modal } from "./modal";
import { Button, Card, cx, LinkButton } from "./ui";
import { isOff, PRESETS, presetOf, TOOLS, toolById, toolOfPath, turnOff, turnOn, type PresetId, type ToolId } from "@/lib/tools";
import { askForTool, setUmbrellaTools, turnOnTool } from "@/server/tools";

const names = (ids: ToolId[]) => {
  const n = ids.map((t) => toolById[t].name);
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
};

export type GateInfo = { g: string; hub: string; cycles: string[]; name: string; tools: ToolId[]; canTurnOn: boolean; kept: Partial<Record<ToolId, string>> };

/**
 * Old links to a tool that's off (ver_128): instead of the page, a short note saying where it
 * went, that nothing was deleted, and Turn on (Admins) or Ask an admin (everyone else).
 */
export function ToolGate({ info, children }: { info: GateInfo; children: ReactNode }) {
  const path = usePathname();
  const tool = toolOfPath(path, info);
  if (!tool || info.tools.includes(tool)) return <>{children}</>;
  return <ToolOff info={info} tool={tool} />;
}

function ToolOff({ info, tool }: { info: GateInfo; tool: ToolId }) {
  const t = toolById[tool];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const also = turnOn(info.tools, tool).also;
  const turn = () =>
    start(async () => {
      const r = await turnOnTool(info.g, tool);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  const ask = () =>
    start(async () => {
      const r = await askForTool(info.g, tool);
      if (!r.ok) return setError(r.error);
      setAsked(
        r.emailed
          ? `Sent. ${r.emailed === 1 ? "The Admin was" : `${r.emailed} Admins were`} emailed, and they can turn it on in Settings → Tools.`
          : r.admins.length
            ? `Asked. ${r.admins.join(", ")} can turn it on in Settings → Tools. Email isn't set up, so you may want to tell them too.`
            : `Asked. Only an Admin can turn it on in Settings → Tools.`,
      );
    });
  return (
    <div className="mx-auto max-w-xl pt-6" data-testid="tool-off">
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-slate-900">
          {isOff(t)} in {info.name}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {info.kept[tool] ?? "Nothing made with it was deleted."} Turn {t.name} back on and {t.plural ? "they're" : "it's"} all here again.
        </p>
        {info.canTurnOn && also.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {names(also)} {also.length === 1 ? "turns" : "turn"} on too, because {t.name} {t.plural ? "need" : "needs"} {also.length === 1 ? "it" : "them"}.
          </p>
        )}
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {asked && (
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            {asked}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {info.canTurnOn ? (
            <Button variant="primary" disabled={pending} onClick={turn}>
              {pending ? "Turning on…" : `Turn on ${t.name}`}
            </Button>
          ) : (
            !asked && (
              <Button variant="primary" disabled={pending} onClick={ask} title={`Sends ${info.name}'s Admins a note asking for ${t.name}`}>
                {pending ? "Asking…" : "Ask an admin"}
              </Button>
            )
          )}
          <LinkButton href={`/g/${info.g}`}>Back to Overview</LinkButton>
        </div>
      </Card>
    </div>
  );
}

/** One row per tool with its switch; used in Settings → Tools and in the New umbrella box's Pick my own. */
function ToolList({ on, onToggle, disabled, compact, extra }: { on: ToolId[]; onToggle: (id: ToolId, next: boolean) => void; disabled?: boolean; compact?: boolean; extra?: (id: ToolId) => ReactNode }) {
  return (
    <ul className={cx("divide-y divide-slate-100", !compact && "rounded-md border border-slate-200")} aria-label="Tools">
      {TOOLS.map((t) => {
        const isOn = on.includes(t.id);
        return (
          <li key={t.id} className={cx("flex items-start gap-3", compact ? "py-2" : "px-3 py-2.5")}>
            <button
              type="button"
              role="switch"
              aria-checked={isOn}
              aria-label={t.name}
              disabled={disabled}
              onClick={() => onToggle(t.id, !isOn)}
              className={cx("relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60", isOn ? "bg-accent-600" : "bg-slate-300")}
            >
              <span className={cx("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all", isOn ? "left-4" : "left-0.5")} />
            </button>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-900">{t.name}</span>
              <span className="block text-xs text-slate-500">{t.what}</span>
              {t.needs.length > 0 && (
                <span className="block text-xs text-slate-500">
                  Needs {names(t.needs)}
                  {t.why ? `, because ${t.why}` : ""}
                </span>
              )}
              {extra?.(t.id)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What's in each tool, for "Turn off Test cases?". */
export type ToolCounts = Partial<Record<ToolId, string>>;

/** Settings → Tools (ver_128). Admins flip switches; turning off a tool that has things in it asks first. */
export function ToolsPanel({ groupId, umbrella, tools, canEdit, counts, jira }: { groupId: string; umbrella: string; tools: ToolId[]; canEdit: boolean; counts: ToolCounts; jira: string | null }) {
  const router = useRouter();
  const [on, setOn] = useState(tools);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<ToolId | null>(null);
  const [pending, start] = useTransition();
  const save = (next: ToolId[], msg: string) => {
    const was = on;
    setOn(next);
    start(async () => {
      const r = await setUmbrellaTools(groupId, next);
      if (!r.ok) {
        setOn(was);
        setNote(null);
        return setError(r.error);
      }
      setError(null);
      setNote(msg);
      router.refresh();
    });
  };
  const off = (id: ToolId) => {
    const t = toolById[id];
    const { on: next, also } = turnOff(on, id);
    const held = [id, ...also].filter((x) => counts[x]);
    const list = held.map((x) => counts[x]).join(" and ");
    save(next, `${t.name} ${t.plural ? "are" : "is"} off. Nothing was deleted${list ? `, just hidden: ${list}` : ""}.${also.length ? ` ${names(also)} turned off too, because ${also.length > 1 ? "they need" : "it needs"} ${t.name}.` : ""}`);
  };
  const toggle = (id: ToolId, next: boolean) => {
    if (next) {
      const t = toolById[id];
      const { on: list, also } = turnOn(on, id);
      return save(list, `${t.name} ${t.plural ? "are" : "is"} on.${also.length ? ` ${names(also)} turned on too, because ${t.name} ${t.plural ? "need" : "needs"} ${also.length > 1 ? "them" : "it"}.` : ""}`);
    }
    const held = [id, ...turnOff(on, id).also].some((x) => counts[x]);
    if (held) setAsking(id);
    else off(id);
  };
  const askingTool = asking ? toolById[asking] : null;
  const askingAlso = asking ? turnOff(on, asking).also : [];
  const askingHeld = asking ? [asking, ...askingAlso].filter((x) => counts[x]).map((x) => counts[x]) : [];
  return (
    <div className="space-y-3" data-testid="tools-panel">
      <p className="text-sm text-slate-600">
        <b>Always there:</b> Overview, Bugs, Reports, Settings and Members. Jira, Slack and bug templates stay in Settings because every tool can log bugs.
      </p>
      {!canEdit && <p className="text-xs text-slate-500">Only Admins can change this.</p>}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {note && (
        <p className="rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-800" role="status" data-testid="tools-note">
          {note}
        </p>
      )}
      <ToolList
        on={on}
        onToggle={toggle}
        disabled={!canEdit || pending}
        extra={(id) => (id === "stories" && on.includes("stories") ? <span className="block text-xs text-slate-500">{jira ? `Uses the Jira connection · Connected to ${jira}` : "Uses the Jira connection · Not connected yet"}</span> : null)}
      />
      <Modal open={!!askingTool} onClose={() => setAsking(null)} title={askingTool ? `Turn off ${askingTool.name}?` : ""}>
        {askingTool && (
          <>
            <p className="text-sm text-slate-600">
              {umbrella} has {askingHeld.join(" and ")}. Everything in it will be hidden, not deleted.
              {askingAlso.length > 0 && ` ${names(askingAlso)} ${askingAlso.length === 1 ? "uses" : "use"} ${askingTool.plural ? "them" : "it"}, so ${askingAlso.length === 1 ? "it turns" : "they turn"} off too.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setAsking(null)}>Keep it on</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const id = asking!;
                  setAsking(null);
                  off(id);
                }}
              >
                {askingAlso.length === 0 ? `Turn off ${askingTool.name}` : askingAlso.length === 1 ? "Turn off both" : `Turn off all ${askingAlso.length + 1}`}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/** The New umbrella box's "What will you use?" (ver_128): four choices, and switches for Pick my own. */
export function ToolPicker({ on, onChange }: { on: ToolId[]; onChange: (on: ToolId[]) => void }) {
  const [preset, setPreset] = useState<PresetId>(() => presetOf(on));
  const turnedOn = names(on);
  return (
    <fieldset className="mt-4 rounded-md border border-slate-200 p-3" data-testid="tool-picker">
      <legend className="px-1 text-sm font-medium text-slate-700">What will you use?</legend>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What will you use?">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            onClick={() => {
              setPreset(p.id);
              if (p.tools) onChange([...p.tools]);
            }}
            className={cx("rounded-md border px-3 py-2 text-left", preset === p.id ? "border-accent-600 bg-accent-50 ring-1 ring-accent-600" : "border-slate-200 hover:border-slate-300")}
          >
            <span className="block text-sm font-medium text-slate-900">{p.name}</span>
            <span className="block text-xs text-slate-500">{p.text}</span>
          </button>
        ))}
      </div>
      {preset === "own" && (
        <div className="mt-2">
          <ToolList compact on={on} onToggle={(id, next) => onChange(next ? turnOn(on, id).on : turnOff(on, id).on)} />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {preset !== "own" && preset !== "all" ? `Turns on: ${turnedOn}. ` : ""}
        You can change this any time in Settings → Tools. Nothing you make is lost when you turn a tool off.
      </p>
    </fieldset>
  );
}
