/** The tabs Export → PDF report offers (ver_91), and which start ticked. Client-safe. */
export function exportTabs(cycle: boolean) {
  return [
    { id: "rc", label: "Release status summary", on: true },
    { id: "status", label: "Execution status", on: true },
    { id: "trends", label: "Trends" },
    { id: "steps", label: "Step results" },
    { id: "failing", label: "Failing steps", on: true },
    { id: "regression", label: "Regression", on: true },
    { id: "defects", label: "Bugs found", on: true },
    { id: "cases", label: "Case history", note: "long: every case" },
    { id: "testers", label: "Testers" },
    { id: "requirements", label: "Requirements coverage" },
    ...(cycle ? [{ id: "findings", label: "Session findings" }] : []),
  ];
}
