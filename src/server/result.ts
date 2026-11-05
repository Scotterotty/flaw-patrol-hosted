import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { Forbidden } from "@/lib/session";
import { duplicateMessage } from "@/lib/duplicate-message";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Run an action body and turn expected failures into a message for the form. */
export async function attempt<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof UserError || e instanceof Forbidden) return { ok: false, error: e.message };
    if (e instanceof ZodError) {
      // Messages are written as plain sentences, so no field name or "Input:" goes in front.
      return { ok: false, error: e.issues[0].message };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: duplicateMessage(e.meta?.target) };
    }
    // Let Next.js redirects and not-found signals through.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export class UserError extends Error {}

