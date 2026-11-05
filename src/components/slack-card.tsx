"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ALERTS, alertSummary, DEFAULT_ALERTS, DETAIL_CHOICES, SEV_CHOICES, webhookProblem, type Alerts } from "@/lib/slack-alerts";
import { addSlackChannel, pauseSlack, removeSlackChannel, setCycleSlack, testSlack, updateSlackChannel, type SlackTarget } from "@/server/slack";
import { Button, Card, cx, ErrorText, InfoTip, Input, Select } from "./ui";

export type ChannelView = { id: string; name: string; alerts: Alerts; paused: boolean; readable: boolean; hookEnd: string };

/** Settings → Slack alerts: as many channels as needed, each with its own alerts. */
export function SlackCard({ target, channels, canManage, id = "slack", title = "Slack alerts", tip }: { target: SlackTarget; channels: ChannelView[]; canManage: boolean; id?: string; title?: string; tip: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ChannelView | "new" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const allPaused = channels.length > 0 && channels.every((c) => c.paused);
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.();
      router.refresh();
    });
  return (
    <Card id={id} className="scroll-mt-20 space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold text-slate-800">
          {title} <InfoTip text={tip} />
          {allPaused && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Paused</span>}
        </h2>
        {canManage && !editing && (
          <div className="flex gap-2">
            {channels.length > 0 && (
              <Button size="sm" disabled={pending} onClick={() => run(() => pauseSlack(target, !allPaused))} title={allPaused ? "Start posting again" : "Stop every channel posting until you resume. Nothing is deleted."}>
                {allPaused ? "Resume all" : "Pause all"}
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => setEditing("new")} data-howto="slack-add">
              ＋ Add channel
            </Button>
          </div>
        )}
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {channels.length === 0 && editing !== "new" && <p className="text-sm text-slate-500">No channels yet.</p>}
      {channels.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {channels.map((c) =>
            editing !== "new" && editing?.id === c.id ? (
              <li key={c.id} className="p-3">
                <ChannelForm target={target} channel={c} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{c.name}</span>
                {c.paused && <span className="rounded bg-amber-50 px-1.5 text-xs text-amber-800">Paused</span>}
                <span className="min-w-0 flex-1 text-xs text-slate-500">{alertSummary(c.alerts)}</span>
                {!c.readable && (
                  <span className="text-xs text-red-700" title="The link was saved with a different AUTH_SECRET. Change the channel and paste its webhook link again.">
                    Webhook link can&apos;t be read
                  </span>
                )}
                {note?.id === c.id && (
                  <span role="status" className={cx("text-xs", note.ok ? "text-emerald-700" : "text-red-700")}>
                    {note.text}
                  </span>
                )}
                {canManage &&
                  (removing === c.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      Remove {c.name}? Its webhook link is deleted.
                      <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => removeSlackChannel(target, c.id), () => setRemoving(null))}>
                        Remove
                      </Button>
                      <Button size="sm" onClick={() => setRemoving(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <span className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending || !c.readable}
                        onClick={() =>
                          start(async () => {
                            const r = await testSlack(target, { channelId: c.id, name: c.name });
                            setNote({ id: c.id, ok: r.ok, text: r.ok ? "Test message sent." : r.error });
                          })
                        }
                      >
                        Send test
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                        Change
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(c.id)}>
                        Remove
                      </Button>
                    </span>
                  ))}
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" && (
        <div className="rounded-md border border-slate-200 p-3">
          <ChannelForm target={target} channel={null} onDone={() => setEditing(null)} />
        </div>
      )}
    </Card>
  );
}

/** Add or change a channel: 1 Channel (webhook link and name), 2 Alerts. */
function ChannelForm({ target, channel, onDone }: { target: SlackTarget; channel: ChannelView | null; onDone: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [webhook, setWebhook] = useState("");
  const [name, setName] = useState(channel?.name ?? "");
  const [alerts, setAlerts] = useState<Alerts>(channel?.alerts ?? DEFAULT_ALERTS);
  const [tested, setTested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hookError = webhook.trim() ? webhookProblem(webhook, false) : null;
  const canNext = name.trim() && (channel ? !webhook.trim() || !hookError : webhook.trim() && !hookError);
  const save = () =>
    start(async () => {
      setError(null);
      const r = channel ? await updateSlackChannel(target, channel.id, { name, webhook, alerts }) : await addSlackChannel(target, { name, webhook, alerts });
      if (!r.ok) return setError(r.error);
      onDone();
      router.refresh();
    });
  const Steps = (
    <ol className="flex gap-3 text-xs" aria-label="Steps">
      <li className={cx(step === 1 ? "font-semibold text-accent-700" : "text-slate-500")}>{step === 2 ? "✓" : "1"} Channel</li>
      <li className={cx(step === 2 ? "font-semibold text-accent-700" : "text-slate-500")}>2 Alerts</li>
    </ol>
  );
  return (
    <div className="space-y-3">
      {Steps}
      {step === 1 ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
              Slack webhook link
              <InfoTip text="In Slack: Apps › Incoming Webhooks › Add to Slack, pick the channel, then copy the Webhook URL. It's kept encrypted, like the Jira token." />
            </span>
            <Input
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              placeholder={channel ? `Saved link ${channel.hookEnd}. Paste a new one to change it.` : "https://hooks.slack.com/services/…"}
              aria-invalid={!!hookError}
              autoFocus
            />
            {hookError && <span className="mt-1 block text-xs text-red-700">{hookError}</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
              Channel name <InfoTip text="Only used to label it here and in messages. Slack decides the channel from the webhook link." />
            </span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="#qa-alerts" className="w-60" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending || (!webhook.trim() && !channel) || !!hookError}
              onClick={() =>
                start(async () => {
                  setTested(null);
                  const r = await testSlack(target, webhook.trim() ? { webhook, name } : { channelId: channel!.id, name });
                  if (!r.ok) return setError(r.error);
                  setError(null);
                  setTested(`Sent. Check ${name.trim() || "the channel"} in Slack.`);
                })
              }
            >
              Send test message
            </Button>
            <span role="status" className="text-xs text-emerald-700">
              {tested}
            </span>
          </div>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={onDone}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!canNext} onClick={() => setStep(2)}>
              Next: pick alerts
            </Button>
          </div>
        </>
      ) : (
        <>
          {(["now", "progress"] as const).map((g) => (
            <fieldset key={g} className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{g === "now" ? "Needs attention now" : "Progress"}</legend>
              {ALERTS.filter((a) => a.group === g).map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" role="switch" checked={alerts[a.id]} onChange={(e) => setAlerts((x) => ({ ...x, [a.id]: e.target.checked }))} />
                    {a.label}
                  </label>
                  <InfoTip text={a.tip} />
                  {(a.id === "run" || a.id === "bash") && alerts[a.id] && (
                    <Select
                      aria-label={a.id === "run" ? "Run finished post" : "Bug bash ended post"}
                      value={String(a.id === "run" ? alerts.runDetail : alerts.bashDetail)}
                      onChange={(e) => setAlerts((x) => ({ ...x, [a.id === "run" ? "runDetail" : "bashDetail"]: e.target.value === "true" }))}
                      className="h-8 w-auto text-xs"
                    >
                      {DETAIL_CHOICES[a.id].map((c) => (
                        <option key={String(c.id)} value={String(c.id)}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  {a.id === "bug" && alerts.bug && (
                    <Select aria-label="Severity" value={alerts.sev} onChange={(e) => setAlerts((x) => ({ ...x, sev: e.target.value as Alerts["sev"] }))} className="h-8 w-auto text-xs">
                      {SEV_CHOICES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              ))}
            </fieldset>
          ))}
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button size="sm" variant="primary" disabled={pending} onClick={save}>
              Save channel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A test cycle in an umbrella: Same as the umbrella (default), Choose channels, or Off. */
export function CycleSlack({
  projectId,
  mode,
  picked,
  umbrella,
  umbrellaChannels,
  own,
  canManage,
  settingsHref,
}: {
  projectId: string;
  mode: "umbrella" | "choose" | "off";
  picked: string[];
  umbrella: string;
  umbrellaChannels: ChannelView[];
  own: ChannelView[];
  canManage: boolean;
  settingsHref: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(mode);
  const [ticks, setTicks] = useState<string[]>(mode === "choose" ? picked : umbrellaChannels.map((c) => c.id));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const label = { umbrella: `Following ${umbrella}`, choose: "Own choice", off: "Off" }[mode];
  const save = (m = choice, ids = ticks) =>
    start(async () => {
      setSaved(false);
      const r = await setCycleSlack(projectId, { mode: m, channelIds: ids });
      if (!r.ok) return setError(r.error);
      setError(null);
      setSaved(true);
      router.refresh();
    });
  const options = [
    { id: "umbrella" as const, label: `Same as ${umbrella} (default)`, tip: `Posts to ${umbrella}'s channels, including ones added later.` },
    { id: "choose" as const, label: "Choose channels for this test cycle", tip: `Turn ${umbrella}'s channels on or off here, or add a channel just for this test cycle.` },
    { id: "off" as const, label: "Off for this test cycle", tip: "Nothing from this test cycle posts. Handy for a practice test cycle." },
  ];
  return (
    <>
      <Card id="slack" className="scroll-mt-20 space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          Slack alerts <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{label}</span>
        </h2>
        {!canManage ? (
          <p className="text-sm text-slate-600">
            {mode === "off" ? "Nothing from this test cycle posts to Slack." : `Posts to ${(mode === "umbrella" ? umbrellaChannels : [...umbrellaChannels.filter((c) => picked.includes(c.id)), ...own]).map((c) => c.name).join(", ") || "no channels yet"}.`}
          </p>
        ) : (
          <>
            <fieldset className="space-y-1.5 text-sm">
              <legend className="sr-only">Where this test cycle posts</legend>
              {options.map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="cycle-slack" checked={choice === o.id} onChange={() => setChoice(o.id)} />
                    {o.label}
                  </label>
                  <InfoTip text={o.tip} />
                </div>
              ))}
            </fieldset>
            {choice === "choose" && (
              <fieldset className="space-y-1 rounded-md border border-slate-200 p-3 text-sm">
                <legend className="px-1 text-xs font-medium text-slate-600">{umbrella}&apos;s channels</legend>
                {umbrellaChannels.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={ticks.includes(c.id)} onChange={(e) => setTicks((t) => (e.target.checked ? [...t, c.id] : t.filter((x) => x !== c.id)))} />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-slate-500">{alertSummary(c.alerts)}</span>
                  </label>
                ))}
                {!umbrellaChannels.length && (
                  <p className="text-xs text-slate-500">
                    {umbrella} has no channels yet.{" "}
                    <a href={settingsHref} className="text-accent-700 hover:underline">
                      Add them in {umbrella} settings
                    </a>
                  </p>
                )}
              </fieldset>
            )}
            <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="primary" disabled={pending || (choice === mode && (choice !== "choose" || ticks.join() === picked.join()))} onClick={() => save()}>
                Save
              </Button>
              {mode !== "umbrella" && (
                <button
                  type="button"
                  className="text-sm text-accent-700 hover:underline"
                  onClick={() => {
                    setChoice("umbrella");
                    save("umbrella", []);
                  }}
                >
                  Go back to {umbrella}&apos;s channels
                </button>
              )}
              <span role="status" className="text-xs text-emerald-700">
                {saved ? "Saved." : ""}
              </span>
            </div>
          </>
        )}
      </Card>
      {mode === "choose" && (
        <SlackCard target={{ projectId }} channels={own} canManage={canManage} id="slack-own" title="This test cycle's own channels" tip={`Channels only this test cycle posts to, on top of the ${umbrella} channels ticked above.`} />
      )}
    </>
  );
}
