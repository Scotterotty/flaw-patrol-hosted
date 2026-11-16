// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resealOnStart } = await import("./lib/reseal-on-start");
    await resealOnStart();
  }
}
