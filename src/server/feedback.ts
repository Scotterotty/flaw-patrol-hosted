"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { feedbackInput, kindLabel, MAX_SHOT_BYTES, MAX_SHOTS, safeFeedbackPath, SHOT_TYPES, statusSchema } from "@/lib/feedback";
import { requireProjectAction, requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";
import { APP_VERSION } from "@/lib/version";

/**
 * Send feedback about Flaw Patrol. Anyone signed in may. The form sends a JSON "data" field
 * and up to three "shot" pictures. Sent without a name, nothing ties it to the sender.
 */
export async function sendFeedback(form: FormData) {
  return attempt(async () => {
    const user = await requireUser();
    const raw = JSON.parse(String(form.get("data") ?? "{}")) as unknown;
    const input = feedbackInput.parse(raw);
    const files = form.getAll("shot").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_SHOTS) throw new UserError(`Add up to ${MAX_SHOTS} pictures.`);
    for (const f of files) {
      if (!SHOT_TYPES.includes(f.type)) throw new UserError("Pictures can be PNG, JPEG, WebP or GIF.");
      if (f.size > MAX_SHOT_BYTES) throw new UserError("Each picture can be up to 8 MB.");
    }
    if (!input.message && !files.length) throw new UserError("Write a note or add a picture.");
    const shots = await Promise.all(files.map(async (f) => ({ contentType: f.type, size: f.size, data: Buffer.from(await f.arrayBuffer()) })));
    const fb = await db.feedback.create({
      data: {
        kind: input.kind,
        message: input.message,
        place: input.place,
        path: safeFeedbackPath(input.path),
        browser: input.browser,
        appVersion: APP_VERSION,
        userId: input.anonymous ? null : user.id,
        userName: input.anonymous ? "" : (user.name ?? user.email),
        shots: { create: shots },
      },
      select: { id: true },
    });
    revalidatePath("/feedback");
    return { id: fb.id };
  });
}

/** The feedback, if this person may see it: their own, or any for a workspace admin. */
async function visible(id: string) {
  const user = await requireUser();
  const fb = await db.feedback.findUnique({ where: { id: z.string().max(40).parse(id) }, select: { id: true, userId: true, kind: true, message: true, place: true, path: true } });
  if (!fb || (!user.isAdmin && fb.userId !== user.id)) throw new UserError("That feedback isn't there any more.");
  return { user, fb };
}

async function requireWorkspaceAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new UserError("Only a workspace admin can do that.");
  return user;
}

/** A reply from an admin (the sender gets a dot on Feedback), or the sender answering back. */
export async function replyToFeedback(id: string, text: string) {
  return attempt(async () => {
    const { user, fb } = await visible(id);
    const body = z.string().trim().min(1, "Write a reply.").max(5000, "Keep it under 5,000 characters.").parse(text);
    await db.feedbackReply.create({ data: { feedbackId: fb.id, authorId: user.id, authorName: user.name ?? user.email, text: body } });
    // Only someone else's reply is news to the sender.
    if (fb.userId && fb.userId !== user.id) await db.feedback.update({ where: { id: fb.id }, data: { unseen: true } });
    // An answer from the sender moves New feedback nowhere; an admin's reply means someone's looking.
    else await db.feedback.update({ where: { id: fb.id }, data: { updatedAt: new Date() } });
    revalidatePath("/feedback");
    return {};
  });
}

export async function setFeedbackStatus(id: string, status: string) {
  return attempt(async () => {
    await requireWorkspaceAdmin();
    const s = statusSchema.parse(status);
    await db.feedback.update({ where: { id: z.string().max(40).parse(id) }, data: { status: s } });
    revalidatePath("/feedback");
    return {};
  });
}

/** Admins only: gone for good, with its pictures and replies. */
export async function deleteFeedback(id: string) {
  return attempt(async () => {
    await requireWorkspaceAdmin();
    await db.feedback.delete({ where: { id: z.string().max(40).parse(id) } });
    revalidatePath("/feedback");
    return {};
  });
}

/** The sender opened their feedback: the dot on Feedback goes away. */
export async function seenFeedback(id: string) {
  return attempt(async () => {
    const { user, fb } = await visible(id);
    if (fb.userId === user.id) await db.feedback.update({ where: { id: fb.id }, data: { unseen: false } });
    return {};
  });
}

/**
 * Turn into a bug: a bug on the picked test cycle's Bugs page with the note, where it was sent
 * from, and the pictures attached. Needs a workspace admin who can file bugs there.
 */
export async function feedbackToBug(id: string, projectId: string, title: string) {
  return attempt(async () => {
    await requireWorkspaceAdmin();
    const { user, project } = await requireProjectAction(z.string().max(40).parse(projectId), "run:execute");
    const fb = await db.feedback.findUnique({ where: { id: z.string().max(40).parse(id) }, include: { shots: true } });
    if (!fb) throw new UserError("That feedback isn't there any more.");
    const summary = z.string().trim().min(1, "Add a summary").max(300).parse(title);
    const description = [fb.message, "", `From Flaw Patrol feedback (${kindLabel(fb.kind)})${fb.place ? `, sent from ${fb.place}` : ""}.`, `Version ${fb.appVersion}${fb.browser ? ` · ${fb.browser}` : ""}`].join("\n").trim();
    const { defectSeq } = await db.project.update({ where: { id: project.id }, data: { defectSeq: { increment: 1 } } });
    const defect = await db.defect.create({
      data: {
        projectId: project.id,
        number: defectSeq,
        title: summary,
        description,
        createdById: user.id,
        createdBy: user.name ?? user.email,
        files: {
          create: fb.shots.map((s, n) => ({ projectId: project.id, fileName: `feedback-${n + 1}.${s.contentType.split("/")[1] ?? "png"}`, contentType: s.contentType, size: s.size, data: s.data, uploadedById: user.id })),
        },
      },
    });
    const bugHref = `/p/${project.key}/bugs`;
    await db.feedback.update({ where: { id: fb.id }, data: { bugHref, status: fb.status === "new" ? "looking" : fb.status } });
    revalidatePath("/feedback");
    return { bugHref, number: defect.number };
  });
}
