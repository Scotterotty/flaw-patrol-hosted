/**
 * Step timings printed in the terminal window, off unless Flaw Patrol is started
 * with FP_TIMING=1 (in .env, or set in the terminal first). Nothing shows in the app.
 */
export const timingOn = () => process.env.FP_TIMING === "1";

export function startTiming(page: string) {
  const on = timingOn();
  const start = performance.now();
  const steps: { name: string; ms: number }[] = [];
  return {
    /** Times one step; steps that run side by side each get their own line. */
    async step<T>(name: string | ((result: T) => string), work: Promise<T>): Promise<T> {
      if (!on) return work;
      const t = performance.now();
      const result = await work;
      steps.push({ name: typeof name === "string" ? name : name(result), ms: performance.now() - t });
      return result;
    },
    done() {
      if (!on) return;
      const total = performance.now() - start;
      const width = Math.max(5, ...steps.map((s) => s.name.length));
      const line = (name: string, ms: number) => `  ${name.padEnd(width)}  ${Math.round(ms).toString().padStart(6)} ms`;
      console.log([`[FP timing] ${page} at ${new Date().toLocaleTimeString()}`, ...steps.map((s) => line(s.name, s.ms)), line("total", total)].join("\n"));
    },
  };
}
export type Timing = ReturnType<typeof startTiming>;
