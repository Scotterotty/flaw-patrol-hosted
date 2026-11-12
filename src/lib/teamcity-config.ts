// TeamCity (ver_228): the build configurations an umbrella watches on its Status page.
// Plain data, so Settings (a client form) and the server both read it the same way.

export type WatchedBuild = { id: string; name: string; project: string };

/** TeamCity build configuration ids are letters, digits and underscores, like Shop_NightlyWindows. */
export const BUILD_TYPE_ID = /^[A-Za-z0-9_]{1,200}$/;

export function parseBuildTypes(v: unknown): WatchedBuild[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is WatchedBuild => !!b && typeof b.id === "string" && BUILD_TYPE_ID.test(b.id) && typeof b.name === "string")
    .map((b) => ({ id: b.id, name: b.name, project: typeof b.project === "string" ? b.project : "" }));
}
