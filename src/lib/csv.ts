/** RFC 4180 CSV with formula-injection guarding for spreadsheet apps. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((v) => {
          let s = v === null || v === undefined ? "" : String(v);
          if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
