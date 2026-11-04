"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { linkQaseCase } from "@/server/qase";
import { Button, Input, Select } from "./ui";

// One case on Link cases (ver_164): pick its Qase case, type an ID, or don't share it.

export function QaseLinkRow(props: {
  groupId: string;
  caseId: string;
  caseKey: string;
  caseHref: string;
  title: string;
  code: string;
  current: number | null;
  currentTitle: string | null;
  options: { id: number; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (value: string) =>
    start(async () => {
      setError(null);
      const res = await linkQaseCase(props.groupId, props.caseId, value);
      if (!res.ok) return setError(res.error);
      setTyping(false);
      setTyped("");
      router.refresh();
    });
  const { current } = props;
  const now = current && current > 0 ? `${props.code}-${current}${props.currentTitle ? ` ${props.currentTitle}` : ""}` : current === 0 ? "Not shared" : null;
  const id = `qase-${props.caseId}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
      <span className="min-w-0 flex-1 basis-60">
        <Link href={props.caseHref} className="mr-1.5 font-mono text-xs text-slate-500 hover:underline">
          {props.caseKey}
        </Link>
        <label htmlFor={id} className="text-slate-900">
          {props.title}
        </label>
      </span>
      {now && <span className="text-xs text-slate-500">{now}</span>}
      {props.canEdit &&
        (typing ? (
          <span className="flex items-center gap-1.5">
            <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`${props.code}-42`} className="w-32" autoFocus />
            <Button size="sm" variant="primary" onClick={() => save(typed)} disabled={pending || !typed.trim()}>
              Link
            </Button>
            <Button size="sm" onClick={() => setTyping(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Select
            id={id}
            className="w-auto min-w-72 max-w-full"
            value=""
            disabled={pending}
            aria-label={`Qase case for ${props.title}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "type") setTyping(true);
              else if (v === "__unlink") save("");
              else if (v) save(v);
            }}
          >
            <option value="">{current === null ? "Pick a Qase case…" : "Change…"}</option>
            {props.options.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.label}
              </option>
            ))}
            <option value="type">Type a Qase ID…</option>
            {current !== 0 && <option value="skip">Don&apos;t share this case</option>}
            {current !== null && <option value="__unlink">{current === 0 ? "Share it again (pick later)" : "Unlink"}</option>}
          </Select>
        ))}
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </li>
  );
}
