"use client";

import { useState } from "react";
import { Button, cx, Input } from "./ui";

/**
 * Pick a platform, or make a new one (ver_99). Nothing is picked to start with.
 * A new name joins the umbrella's platforms when the test cycle is made
 * (addUmbrellaProject), so it shows up everywhere platforms are picked.
 */
export function PlatformPicker({ id, platforms, umbrella, value, onChange }: { id: string; platforms: string[]; umbrella: string; value: string; onChange: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  // Names typed here that the umbrella doesn't have yet.
  const [added, setAdded] = useState<string[]>([]);
  const all = [...platforms, ...added];
  const add = () => {
    const name = typed.trim();
    if (!name) return;
    const known = all.find((p) => p.toLowerCase() === name.toLowerCase());
    if (!known) setAdded((a) => [...a, name]);
    onChange(known ?? name);
    setTyped("");
    setAdding(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Platform">
        {all.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            onClick={() => onChange(value === p ? "" : p)}
            className={cx("rounded-full border px-3 py-1 text-sm", value === p ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700 hover:bg-slate-50")}
          >
            {p}
            {added.includes(p) && <span className="ml-1 text-xs font-normal text-slate-500">(new)</span>}
          </button>
        ))}
        {!adding && (
          <button type="button" className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setAdding(true)}>
            ＋ New platform
          </button>
        )}
        {value && (
          <button type="button" className="text-xs text-accent-700 hover:underline" onClick={() => onChange("")}>
            No platform
          </button>
        )}
      </div>
      {adding && (
        <div className="space-y-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 p-2">
          <div className="flex flex-wrap gap-2">
            <Input
              id={id}
              aria-label="New platform name"
              className="h-8 min-w-36 flex-1"
              value={typed}
              maxLength={30}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="e.g. Android"
              autoFocus
            />
            <Button size="sm" onClick={add} disabled={!typed.trim()}>
              Add platform
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-slate-500">Added to {umbrella}&apos;s platforms, so it shows up everywhere you pick a platform, in Release candidate and in the platform filters.</p>
        </div>
      )}
    </div>
  );
}
