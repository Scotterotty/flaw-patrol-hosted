export type DiffOp<T> = { op: "same" | "added" | "removed"; value: T };

/** Longest-common-subsequence diff, fine for the tens of steps a case has. */
export function diffLists<T>(before: T[], after: T[], key: (v: T) => string = (v) => JSON.stringify(v)): DiffOp<T>[] {
  const a = before.map(key);
  const b = after.map(key);
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ op: "same", value: after[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "removed", value: before[i++] });
    } else {
      out.push({ op: "added", value: after[j++] });
    }
  }
  while (i < m) out.push({ op: "removed", value: before[i++] });
  while (j < n) out.push({ op: "added", value: after[j++] });
  return out;
}
