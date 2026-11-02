/**
 * The people an Assign list offers: everyone but Viewers, who can't record results.
 * Lists that only show names (filters, avatars) keep everyone.
 */
export const assignable = <T extends { canTest?: boolean }>(members: T[]) => members.filter((m) => m.canTest !== false);
