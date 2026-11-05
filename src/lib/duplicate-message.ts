/**
 * Plain words for a unique-key clash. Only names and keys are "taken"; a clash on
 * anything else (like one bug linked twice to a result) is a double save, and saying
 * "That name is already taken" there sent people looking for a name field.
 */
export function duplicateMessage(target: unknown): string {
  // Field names, or a constraint name like "Section_projectId_parentId_name_key".
  const parts = (Array.isArray(target) ? target.map(String) : String(target ?? "").replace(/_p?key$/, "").split("_")).filter(Boolean);
  if (!parts.length || parts.some((f) => /name$|^key$|^slug$/i.test(f))) return "That name is already taken.";
  if (parts.some((f) => /^email$/i.test(f))) return "That email is already in use.";
  return "That was already saved. Reload the page and try again.";
}
