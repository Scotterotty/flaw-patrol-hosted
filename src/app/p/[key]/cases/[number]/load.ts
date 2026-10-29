import "server-only";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

export async function loadCase(projectId: string, rawNumber: string) {
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number < 1) notFound();
  const testCase = await db.testCase.findUnique({
    where: { projectId_number: { projectId, number } },
    include: { versions: { orderBy: { version: "desc" } }, persona: true },
  });
  if (!testCase) notFound();
  return testCase;
}
