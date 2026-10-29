"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EMPTY_NAV_ORDER, isDefaultOrder } from "@/lib/nav-order";
import { saveMyNavOrder } from "@/server/account";
import { useNavOrder } from "./nav-order";
import { Button, ErrorText } from "./ui";

/** Account → Appearance: whether your left menu is in your own order, and a way back to the default (ver_93). */
export function MenuOrderReset() {
  const router = useRouter();
  const mine = !isDefaultOrder(useNavOrder());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Menu order <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">{mine ? "Your own order" : "Default"}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Change it with Arrange menu order at the bottom of the left menu.</p>
        </div>
        <Button
          size="sm"
          disabled={!mine || pending}
          onClick={() =>
            start(async () => {
              const r = await saveMyNavOrder(EMPTY_NAV_ORDER);
              if (!r.ok) setError(r.error);
              else router.refresh();
            })
          }
        >
          Reset to default order
        </Button>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}
