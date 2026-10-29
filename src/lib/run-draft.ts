import { z } from "zod";
import { MAX_REMINDERS, reminderSchema, sessionLogSchema } from "./charter";

// Kept apart from the server actions so the execute page can read drafts too.
const statusEnum = z.enum(["UNTESTED", "PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED", "EXPLORED"]);

// What the runner autosaves while a case is being tested: everything on screen
// that isn't a saved result yet. Defects are kept as shown so chips come back as they were.
export const draftSchema = z.object({
  stepResults: z.array(z.object({ status: statusEnum, actual: z.string().max(10000).default("") })).max(1000),
  override: statusEnum.exclude(["UNTESTED"]).nullable().default(null),
  comment: z.string().max(10000).default(""),
  elapsedSec: z.number().int().min(0).max(86400 * 7).default(0),
  attachments: z
    .array(z.object({ id: z.string(), fileName: z.string().max(300), contentType: z.string().max(200), stepIndex: z.number().int().min(0).nullable() }))
    .max(200)
    .default([]),
  defects: z
    .array(
      z.object({
        stepIndex: z.number().int().min(0).nullable(),
        defect: z.object({
          id: z.string(),
          number: z.number().int(),
          title: z.string().max(300),
          externalKey: z.string().max(100).nullable(),
          externalUrl: z.string().max(1000).nullable(),
          status: z.string().max(50),
        }),
      }),
    )
    .max(50)
    .default([]),
  // Exploratory sessions: the log so far. The timer is elapsedSec.
  notes: sessionLogSchema.default([]),
  // Reminders the tester added for this session only (the charter's own are on the charter).
  reminders: z.array(reminderSchema).max(MAX_REMINDERS).default([]),
});
export type DraftInput = z.input<typeof draftSchema>;
export type Draft = z.output<typeof draftSchema>;

export function parseDraft(json: unknown): Draft | null {
  const parsed = draftSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
