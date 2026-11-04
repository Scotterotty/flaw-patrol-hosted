const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type StepPiece = { kind: "link" | "value" | "text"; text: string };

/**
 * Step text cut into web addresses, test data values and plain text, in order. StepText
 * links the addresses, picks the values out in blue and underlines Glossary terms in the rest.
 */
export function stepPieces(text: string, values?: string[]): StepPiece[] {
  const vals = values?.filter((v) => v.trim()) ?? [];
  const valueRe = vals.length ? new RegExp(`(${[...vals].sort((a, b) => b.length - a.length).map(escape).join("|")})`, "g") : null;
  return text.split(URL_RE).flatMap((part, i): StepPiece[] => {
    if (i % 2 === 1) return [{ kind: "link", text: part }];
    if (!valueRe) return [{ kind: "text", text: part }];
    return part.split(valueRe).map((bit, j) => ({ kind: j % 2 === 1 ? "value" : "text", text: bit }));
  });
}
