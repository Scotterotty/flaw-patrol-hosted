"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { bashIcs, icsFileName, localBoxes, localInstant, startProblem } from "@/lib/bash-schedule";
import { cancelBash, rescheduleBash } from "@/server/bashes";
import { Button, cx, ErrorText, Input } from "./ui";

// Scheduled bug bashes (ver_153): Add to calendar, Change time and Cancel bash.

export type CalendarBash = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  areas: string[];
  by: string;
  homeKey: string;
};

/** Downloads a calendar invite with the time and the Join link (Outlook, Google, Apple). */
export function AddToCalendar({ bash, size, className }: { bash: CalendarBash; size?: "sm" | "md"; className?: string }) {
  return (
    <Button
      size={size}
      className={className}
      data-testid="bash-add-calendar"
      onClick={() => {
        const url = `${window.location.origin}/p/${bash.homeKey}/bashes/${bash.id}?join=1`;
        const blob = new Blob([bashIcs({ ...bash, url })], {
          type: "text/calendar;charset=utf-8",
        });
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = icsFileName(bash.name);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }}
    >
      <span aria-hidden>📅</span> Add to calendar
    </Button>
  );
}

/** The date and time boxes, on this browser's clock, with the zone shown after them. */
export function WhenBoxes({ day, time, onDay, onTime, idPrefix }: { day: string; time: string; onDay: (v: string) => void; onTime: (v: string) => void; idPrefix: string }) {
  const [zone, setZone] = useState("");
  useEffect(() => setZone(new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() ?? ""), []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input id={`${idPrefix}-day`} type="date" aria-label="Start date" value={day} onChange={(e) => onDay(e.target.value)} className="w-40" />
      <Input id={`${idPrefix}-time`} type="time" aria-label="Start time" value={time} onChange={(e) => onTime(e.target.value)} className="w-32" />
      {zone && <span className="text-xs text-slate-500">{zone}</span>}
    </div>
  );
}

/** Change time and Cancel bash, for whoever set it up (and leads), while it's coming up. */
export function ScheduleControls({ bashId, startsAt, homeKey }: { bashId: string; startsAt: string; homeKey: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "move" | "cancel">("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const link = "text-sm font-medium text-accent-700 hover:underline";

  if (!mode)
    return (
      <span className="inline-flex items-center gap-3">
        <button
          type="button"
          className={link}
          onClick={() => {
            const b = localBoxes(new Date(startsAt));
            setDay(b.day);
            setTime(b.time);
            setError(null);
            setMode("move");
          }}
        >
          Change time
        </button>
        <button type="button" className={cx(link, "text-red-700")} onClick={() => (setError(null), setMode("cancel"))}>
          Cancel bash
        </button>
      </span>
    );

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2" data-testid={mode === "move" ? "bash-move" : "bash-cancel"}>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {mode === "move" ? (
        <>
          <span className="text-sm text-slate-700">New start:</span>
          <WhenBoxes idPrefix={`move-${bashId}`} day={day} time={time} onDay={setDay} onTime={setTime} />
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const at = localInstant(day, time);
                const problem = startProblem(at);
                if (problem) return setError(problem);
                const res = await rescheduleBash(bashId, at!.toISOString());
                if (!res.ok) return setError(res.error);
                setMode("");
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save time"}
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm text-slate-700">Cancel this bug bash? Everyone loses the link. Nothing was logged yet.</span>
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await cancelBash(bashId);
                if (!res.ok) return setError(res.error);
                router.push(`/p/${homeKey}/bashes`);
                router.refresh();
              })
            }
          >
            {pending ? "Cancelling…" : "Yes, cancel it"}
          </Button>
        </>
      )}
      <Button size="sm" disabled={pending} onClick={() => setMode("")}>
        {mode === "move" ? "Keep the old time" : "Keep it"}
      </Button>
    </div>
  );
}
