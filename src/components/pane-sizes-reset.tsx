"use client";

import { useEffect, useState } from "react";
import { resetAllPanes } from "./pane-resizer";
import { Button } from "./ui";

/** Account → Appearance: panels you've made wider or narrower by dragging their edge, and a way back. */
export function PaneSizesReset() {
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    try {
      setCount(Object.keys(localStorage).filter((k) => k.startsWith("fp-pane:")).length);
    } catch {}
  }, []);
  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Panel sizes{" "}
            <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
              {count ? `${count} resized` : "Normal"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Drag the line beside a side panel to make it wider or narrower. Saved on this computer only.
          </p>
        </div>
        <Button
          size="sm"
          disabled={!count}
          onClick={() => {
            resetAllPanes();
            setCount(0);
            setDone(true);
          }}
        >
          Reset panel sizes
        </Button>
      </div>
      {done && !count && (
        <p role="status" className="mt-1 text-xs text-emerald-700">
          All panels are back to their normal size.
        </p>
      )}
    </div>
  );
}
