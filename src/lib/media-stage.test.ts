import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Its own temp folder, so the test never touches real staged uploads.
const tmp = mkdtempSync(join(tmpdir(), "fp-stage-test-"));
process.env.TMPDIR = tmp;
process.env.STAGE_LIMIT_MB = "1";
const { loadStage, stageMedia } = await import("./media-stage");
afterAll(() => {
  delete process.env.STAGE_LIMIT_MB;
});

const file = (kb: number) => [{ path: "shot.png", kind: "screenshot" as const, contentType: "image/png", bytes: new Uint8Array(kb * 1024) }];
const folders = () => readdirSync(join(tmp, "flaw-patrol-media"));

describe("staged uploads have a size cap (backend review: upload DoS)", () => {
  it("keeps each person's latest three", async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await stageMedia(file(10), "u1"));
    expect(await loadStage(ids[0], "u1")).toEqual([]);
    expect((await loadStage(ids[3], "u1")).length).toBe(1);
    expect(folders().length).toBe(3);
  });

  it("makes room by clearing the oldest when the folder is full", async () => {
    const a = await stageMedia(file(400), "u2");
    const b = await stageMedia(file(400), "u3");
    // u1's three small ones and a are oldest; 400 KB more needs room.
    const c = await stageMedia(file(400), "u4");
    expect((await loadStage(c, "u4")).length).toBe(1);
    expect((await loadStage(b, "u3")).length).toBe(1);
    expect(await loadStage(a, "u2")).toEqual([]);
  });
});
