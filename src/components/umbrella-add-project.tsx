"use client";

import { keyFromName } from "@/lib/cycle-key";
import { PlatformPicker } from "./platform-picker";
import { useState } from "react";
import { addUmbrellaProject, moveCasesIntoUmbrella } from "@/server/umbrella";
import { setProjectGroup } from "@/server/groups";
import { Modal } from "./modal";
import { Button, ErrorText, Field, Input } from "./ui";
import { MoreMenu } from "./more-menu";
import { useAction, plural } from "./umbrella-action";

/** A project outside any umbrella that could move into this one. */
export type LooseProject = { id: string; name: string; key: string; cases: number };

/**
 * "Add project" on an umbrella: make a new project under it, or move in one that
 * isn't in an umbrella yet. As a menu in the hub's header, or as two buttons
 * where the umbrella has no projects at all.
 */
export function AddUmbrellaProject({
  groupId,
  umbrella,
  platforms,
  colors = [],
  loose,
  as = "menu",
  label = "＋ Add test cycle",
}: {
  groupId: string;
  umbrella: string;
  platforms: string[];
  /** Each platform's dot color, in the same order. */
  colors?: string[];
  loose: LooseProject[];
  as?: "menu" | "buttons";
  label?: string;
}) {
  const [box, setBox] = useState<"new" | "move" | null>(null);
  return (
    <>
      {as === "menu" ? (
        <MoreMenu label={label} howto="settings-add-cycle" title="A test cycle is one round of testing, such as one release on one platform. It holds that round's test runs, results and bugs.">
          <Button onClick={() => setBox("new")} className="!items-start text-left" data-howto="add-cycle-new">
            <span>
              New test cycle
              <span className="block text-xs text-slate-500">Uses {umbrella}&apos;s cases, Jira and team</span>
            </span>
          </Button>
          {loose.length > 0 && (
          <Button onClick={() => setBox("move")} className="!items-start text-left">
            <span>
              Move in a test cycle you already have
              <span className="block text-xs text-slate-500">Its runs stay. Its cases can join the {umbrella} case library.</span>
            </span>
          </Button>
          )}
        </MoreMenu>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => setBox("new")}>
            New test cycle
          </Button>
          {loose.length > 0 && <Button onClick={() => setBox("move")}>Move in an existing one</Button>}
        </div>
      )}
      {box === "new" && <NewUmbrellaProject groupId={groupId} umbrella={umbrella} platforms={platforms} colors={colors} onClose={() => setBox(null)} />}
      {box === "move" && <MoveIntoThisUmbrella groupId={groupId} umbrella={umbrella} loose={loose} onClose={() => setBox(null)} />}
    </>
  );
}

/**
 * New project in an umbrella: one platform, one round of testing. It gets the umbrella's cases, Jira and team.
 * Pick a platform chip or add a new one; a new name joins the umbrella's platforms.
 * Nothing is picked for you.
 */
function NewUmbrellaProject({ groupId, umbrella, platforms, onClose }: { groupId: string; umbrella: string; platforms: string[]; colors: string[]; onClose: () => void }) {
  const [platform, setPlatform] = useState("");
  // The name box starts empty; the gray name (from the platform) is used if it's left blank. The key follows the name.
  const [name, setName] = useState("");
  const grayName = platform ? `${umbrella} ${platform}` : "";
  const shownName = name.trim() || grayName;
  const [key, setKey] = useState<string | null>(null);
  const { pending, error, setError, run, router } = useAction();
  const shownKey = key ?? keyFromName(shownName);
  return (
    <Modal open onClose={onClose} title={`New test cycle in ${umbrella}`}>
      <p className="text-sm text-slate-500">Testing a release candidate on every platform? Create a run, then Release candidate, makes one test cycle per platform in one go.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="mt-3 space-y-3">
        <Field label="Platform (optional)" htmlFor="ap-platform">
          <PlatformPicker id="ap-platform" platforms={platforms} umbrella={umbrella} value={platform} onChange={setPlatform} />
        </Field>
        <Field label="Name" htmlFor="ap-name" hint={grayName && !name.trim() ? "Leave it blank to use the suggested name shown." : undefined}>
          <Input id="ap-name" data-howto="cycle-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={grayName || "Name this round of testing, like Sprint 14"} />
        </Field>
      </div>
      <div className="mt-3 max-w-[8rem]">
        <Field label="Key" htmlFor="ap-key">
          <Input id="ap-key" value={shownKey} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={10} />
        </Field>
      </div>
      <div className="mt-3 space-y-0.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p className="font-medium text-slate-800">It gets from {umbrella}:</p>
        <p>✓ {umbrella}&apos;s test cases and suites, ready to run</p>
        <p>✓ {umbrella}&apos;s Jira and bug template</p>
        <p>✓ {umbrella}&apos;s team (you can switch this off later with Keep members separate)</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={pending || !shownName}
          data-howto="cycle-create"
          onClick={() =>
            run(
              () => addUmbrellaProject(groupId, { name: shownName, key: shownKey, platform }),
              (r: { key: string }) => router.push(`/p/${r.key}`),
            )
          }
        >
          {pending ? "Creating…" : `Create test cycle in ${umbrella}`}
        </Button>
      </div>
    </Modal>
  );
}

/** Move an existing project into this umbrella, from the umbrella's side. Its library can come along. */
function MoveIntoThisUmbrella({ groupId, umbrella, loose, onClose }: { groupId: string; umbrella: string; loose: LooseProject[]; onClose: () => void }) {
  const [pick, setPick] = useState(loose[0]?.id ?? "");
  const project = loose.find((p) => p.id === pick);
  const [bring, setBring] = useState(true);
  const { pending, error, setError, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`Move a test cycle into ${umbrella}`}>
      <p className="text-sm text-slate-500">It joins {umbrella}&apos;s team, uses its Jira and bug template, and shows in its hub. Its runs and results stay as they are.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {loose.length === 0 ? (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Every test cycle you can move is already in an umbrella. Use New test cycle instead.</p>
      ) : (
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">Test cycle</legend>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {loose.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="move-in" className="accent-accent-600" checked={pick === p.id} onChange={() => setPick(p.id)} />
                <span className="font-mono text-xs font-semibold text-accent-700">{p.key}</span>
                {p.name}
                <span className="text-xs text-slate-500">{plural(p.cases, "case")}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {project && project.cases > 0 && (
        <label className="mt-3 flex items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-slate-800">
          <input type="checkbox" className="mt-0.5 accent-accent-600" checked={bring} onChange={(e) => setBring(e.target.checked)} />
          <span>
            Move its {plural(project.cases, "case")}, suites and shared steps into the {umbrella} case library
            <span className="block text-xs text-slate-500">Same-name cases are matched, not doubled.</span>
          </span>
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={pending || !project}
          onClick={() =>
            run(
              async () => {
                const moved = await setProjectGroup(project!.id, groupId);
                if (!moved.ok || !bring || !project!.cases) return moved;
                return moveCasesIntoUmbrella(groupId, project!.id);
              },
              () => onClose(),
            )
          }
        >
          {pending ? "Moving…" : `Move into ${umbrella}`}
        </Button>
      </div>
    </Modal>
  );
}
