import { describe, expect, it } from "vitest";
import { queueQaseSync } from "./qase-hook-queue";

describe("Qase webhook flood (backend review: no rate limit)", () => {
  it("a burst of webhooks costs one sync plus one more after it", async () => {
    let syncs = 0;
    const sync = async () => {
      syncs++;
    };
    const first = queueQaseSync("g1", sync, 20);
    expect(first).not.toBeNull();
    for (let i = 0; i < 50; i++) expect(queueQaseSync("g1", sync, 20)).toBeNull();
    await first;
    expect(syncs).toBe(2);
    // Quiet again: the next webhook starts a fresh round.
    const next = queueQaseSync("g1", sync, 20);
    expect(next).not.toBeNull();
    await next;
    expect(syncs).toBe(3);
  });

  it("umbrellas don't wait on each other, and a failed sync doesn't stick", async () => {
    const a = queueQaseSync("ga", async () => Promise.reject(new Error("Qase down")), 5);
    const b = queueQaseSync("gb", async () => {}, 5);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await Promise.all([a, b]);
    expect(queueQaseSync("ga", async () => {}, 5)).not.toBeNull();
  });
});
