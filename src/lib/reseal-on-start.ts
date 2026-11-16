import { resealWithEncryptionKey } from "@/lib/reseal";

/** At server start: move secrets sealed with AUTH_SECRET over to ENCRYPTION_KEY (see reseal.ts). */
export async function resealOnStart() {
  if (!process.env.ENCRYPTION_KEY?.trim()) return;
  try {
    const moved = await resealWithEncryptionKey();
    const summary = Object.entries(moved).map(([name, n]) => `${n} ${name}`).join(", ");
    if (summary) console.log(`Re-sealed saved secrets with ENCRYPTION_KEY: ${summary}.`);
  } catch (e) {
    // Never stop the server over this; the next start tries again.
    console.error("Couldn't re-seal saved secrets with ENCRYPTION_KEY:", e instanceof Error ? e.message : e);
  }
}
