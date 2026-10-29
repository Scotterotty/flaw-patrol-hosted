/** A run pulled from GitHub is named after its workflow and GitHub run: "Browser tests · GitHub run 16" (ver_94). */
export function githubRunName(workflow: string, number: number) {
  return [workflow.trim(), `GitHub run ${number}`].filter(Boolean).join(" · ");
}
