import { describe, expect, it } from "vitest";
import { clock, missionLine, nextReminderAt, noteCounts, parseCharter, parseSessionLog, reminderCount, reminderLabel } from "./charter";

describe("charters", () => {
  it("read as one mission sentence, skipping blank parts", () => {
    expect(missionLine({ explore: "checkout", with: "airplane mode", discover: "how payments recover", minutes: 30, reminders: [], prompts: [] })).toBe(
      "Explore checkout with airplane mode to discover how payments recover.",
    );
    expect(missionLine({ explore: "checkout", with: "", discover: "", minutes: 30, reminders: [], prompts: [] })).toBe("Explore checkout.");
    expect(missionLine(parseCharter(null))).toBe("");
  });

  it("fall back to a blank 60 minute charter when the saved one is unreadable", () => {
    expect(parseCharter({ explore: 4 })).toEqual({ explore: "", with: "", discover: "", minutes: 60, reminders: [], prompts: [] });
    expect(parseCharter({ explore: "x", minutes: 45 }).minutes).toBe(45);
  });

  it("count reminders by the session clock", () => {
    const every = { id: "a", repeat: true, sec: 900, text: "" };
    const once = { id: "b", repeat: false, sec: 23 * 60, text: "Switch to mobile data" };
    expect([0, 899, 900, 1800, 3599].map((t) => reminderCount(every, t))).toEqual([0, 0, 1, 2, 3]);
    expect([1379, 1380, 3000].map((t) => reminderCount(once, t))).toEqual([0, 1, 1]);
    expect(nextReminderAt(every, 905)).toBe(1800);
    expect(nextReminderAt(once, 100)).toBe(1380);
    expect(nextReminderAt(once, 1400)).toBeNull();
    expect([reminderLabel(every), reminderLabel(once)]).toEqual(["Every 15 min", "At 23:00"]);
    expect(parseCharter({ minutes: 60, reminders: [every] }).reminders).toEqual([every]);
  });

  it("keep session notes and count them by kind", () => {
    const notes = parseSessionLog([
      { id: "a", at: 5, kind: "bug", text: "Spinner" },
      { id: "b", at: 9, kind: "note", text: "Tried it" },
      { id: "c", at: 12, kind: "bug", text: "Again" },
    ]);
    expect(notes).toHaveLength(3);
    expect(notes[0].attachments).toEqual([]);
    expect(noteCounts(notes)).toEqual({ note: 1, bug: 2, question: 0, idea: 0 });
    expect(parseSessionLog([{ id: "x", kind: "rant" }])).toEqual([]);
  });

  it("show time as m:ss, or h:mm:ss past an hour", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(1800)).toBe("30:00");
    expect(clock(3725)).toBe("1:02:05");
  });
});
