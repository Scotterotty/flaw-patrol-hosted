import "server-only";
import { requireUser } from "@/lib/session";
import { UserError } from "./result";

/** The signed-in person, if they're a workspace admin; otherwise the action stops with a plain message. */
export async function requireWorkspaceAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new UserError("Only a workspace admin can do that.");
  return user;
}
