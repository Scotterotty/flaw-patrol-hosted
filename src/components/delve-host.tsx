"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Bridge = {
  data: unknown;
  save: (keys: Record<string, string>, closing: boolean) => void;
  clear: (runId: string) => Promise<{ bonus: number }>;
  leave: () => void;
};

// Holds the game (public/delve-game) full screen over the app. The game reads its save, the
// person's dungeons and these calls from window.__fpDelve (see public/delve-game/fp-delve.js).
export function DelveHost({ back }: { back: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const w = window as unknown as { __fpDelve?: Bridge };
    fetch("/api/delve", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!live) return;
        w.__fpDelve = {
          data,
          save: (keys, closing) => {
            const body = JSON.stringify({ keys });
            if (closing && navigator.sendBeacon && body.length < 60000) navigator.sendBeacon("/api/delve", new Blob([body], { type: "application/json" }));
            else void fetch("/api/delve", { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 }).catch(() => {});
          },
          clear: (runId) =>
            fetch("/api/delve/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) }).then((r) => r.json()),
          leave: () => router.push(back),
        };
        setReady(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      delete w.__fpDelve;
    };
  }, [back, router]);

  return (
    <div className="fixed inset-0 z-[2147483000] bg-[#071016]">
      {ready && <iframe src="/delve-game/index.html" title="The Delve" className="h-full w-full border-0" allow="clipboard-write" onLoad={(e) => e.currentTarget.contentWindow?.focus()} />}
      {failed && (
        <p className="p-6 text-center text-sm text-white">
          The page didn&apos;t load. <button className="underline" onClick={() => router.push(back)}>Go back</button>
        </p>
      )}
    </div>
  );
}
