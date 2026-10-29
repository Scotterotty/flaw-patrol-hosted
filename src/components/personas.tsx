"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePersona, setPersonaArchived } from "@/server/personas";
import { Modal } from "./modal";
import { Button, Card, cx, ErrorText, Field, Input, LinkButton, Textarea } from "./ui";

export type PersonaRow = { id: string; name: string; emoji: string; description: string; archived: boolean; charters: number; cases: number };

const EMOJIS = ["🧑", "🧓", "👵", "🧒", "🎮", "📱", "💼", "🧑‍💻", "♿", "🌍", "🐢", "⚡"];

/** Where "Write charter" goes: New charter with this persona already picked. */
export const newCharterHref = (projectKey: string, personaId: string) => `/p/${projectKey}/cases/new?charter=1&persona=${personaId}`;

/** The Personas page: who testers pretend to be, with a quick way to write a charter as each one. */
export function PersonasBoard({ projectId, projectKey, personas, canManage, canArchive = canManage, canWrite }: { projectId: string; projectKey: string; personas: PersonaRow[]; canManage: boolean; canArchive?: boolean; canWrite: boolean }) {
  const [editing, setEditing] = useState<PersonaRow | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = personas.filter((p) => !p.archived);
  const archived = personas.filter((p) => p.archived);
  const shown = showArchived ? personas : active;
  const filtered = (p: PersonaRow, type: string) => `/p/${projectKey}/cases?persona=${p.id}&type=${type}`;

  return (
    <div role="region" aria-label="Personas">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Personas</h1>
          <p className="mt-0.5 text-sm text-slate-500">Who you test as. Tag charters and cases with one, and write a charter straight from a persona.</p>
        </div>
        <div className="flex items-center gap-3">
          {archived.length > 0 && (
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "Hide archived" : `Show ${archived.length} archived`}
            </button>
          )}
          {canManage && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              + New persona
            </Button>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium text-slate-800">No personas yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {canManage ? "Add one, like a first-time player or a screen reader user." : "A lead or admin can add them, like a first-time player or a screen reader user."}
          </p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id}>
              <Card className={cx("flex h-full flex-col p-4", p.archived && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl" aria-hidden>
                    {p.emoji}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-medium text-slate-900">
                      {p.name}
                      {p.archived && <span className="ml-2 text-xs font-normal text-slate-500">Archived</span>}
                    </h2>
                    {p.description && <p className="mt-0.5 text-sm text-slate-500">{p.description}</p>}
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500 tabular-nums">
                  <Link href={filtered(p, "EXPLORATORY")} className="text-accent-700 hover:underline">
                    {p.charters} {p.charters === 1 ? "charter" : "charters"}
                  </Link>
                  {" · "}
                  <Link href={filtered(p, "")} className="text-accent-700 hover:underline">
                    {p.cases} {p.cases === 1 ? "case" : "cases"}
                  </Link>
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                  {canWrite && !p.archived && (
                    <LinkButton size="sm" variant="primary" href={newCharterHref(projectKey, p.id)} aria-label={`Write charter as ${p.name}`}>
                      + Write charter
                    </LinkButton>
                  )}
                  {canManage && (
                    <>
                      <Button size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                        Edit
                      </Button>
                      {canArchive && <Button
                        size="sm"
                        disabled={pending}
                        aria-label={`${p.archived ? "Restore" : "Archive"} ${p.name}`}
                        onClick={() =>
                          start(async () => {
                            const r = await setPersonaArchived(projectId, p.id, !p.archived);
                            if (r.ok) router.refresh();
                          })
                        }
                      >
                        {p.archived ? "Restore" : "Archive"}
                      </Button>}
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PersonaForm
          projectId={projectId}
          persona={editing === "new" ? null : editing}
          writeCharterIn={canWrite ? projectKey : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

/**
 * Add or edit a persona. With `writeCharterIn`, a new persona also offers
 * "Add and write a charter", which opens New charter with it picked.
 */
export function PersonaForm({
  projectId,
  persona,
  onClose,
  onSaved,
  writeCharterIn,
}: {
  projectId: string;
  persona: Pick<PersonaRow, "id" | "name" | "emoji" | "description"> | null;
  onClose: () => void;
  onSaved: (p: { id: string; name: string; emoji: string }) => void;
  writeCharterIn?: string;
}) {
  const [name, setName] = useState(persona?.name ?? "");
  const [emoji, setEmoji] = useState(persona?.emoji ?? "🧑");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = (thenCharter: boolean) =>
    start(async () => {
      const r = await savePersona(projectId, persona?.id ?? null, { name, emoji, description });
      if (!r.ok) return setError(r.error);
      onClose();
      if (thenCharter && writeCharterIn) router.push(newCharterHref(writeCharterIn, r.id));
      else onSaved({ id: r.id, name: r.name, emoji: r.emoji });
    });
  return (
    <Modal open onClose={onClose} title={persona ? `Edit ${persona.name}` : "New persona"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          save(false);
        }}
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <Field label="Name" htmlFor="persona-name">
          <Input id="persona-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="First-time player" />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Icon</legend>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <label key={e} className={cx("flex size-9 cursor-pointer items-center justify-center rounded-full text-lg ring-1 ring-inset", emoji === e ? "bg-accent-50 ring-accent-500" : "ring-slate-200 hover:bg-slate-50")}>
                <input type="radio" name="persona-emoji" value={e} checked={emoji === e} onChange={() => setEmoji(e)} className="sr-only" aria-label={e} />
                {e}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="What they're like (optional)" htmlFor="persona-description">
          <Textarea id="persona-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Never played before, skips tutorials, taps everything" />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          {!persona && writeCharterIn ? (
            <>
              <Button type="submit" disabled={pending}>
                Add persona
              </Button>
              <Button variant="primary" disabled={pending || !name.trim()} onClick={() => save(true)}>
                Add and write a charter
              </Button>
            </>
          ) : (
            <Button type="submit" variant="primary" disabled={pending}>
              {persona ? "Save" : "Add persona"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
