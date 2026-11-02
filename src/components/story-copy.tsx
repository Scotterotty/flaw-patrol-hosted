"use client";

import { useState } from "react";
import { exportTabs } from "@/lib/export-tabs";
import { copyRich, ExportMenu } from "./export-menu";
import { Button } from "./ui";

/** Copy for Confluence (keeps the table when pasted) and Download CSV. */
export function CopyCoverage({ html, csv, fileName }: { html: string; csv: string; fileName: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const plain = csv.replace(/"/g, "").replace(/,/g, "\t");
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }
    setDone(true);
    setTimeout(() => setDone(false), 4000);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex items-center gap-2">
      <span role="status" className="text-xs text-emerald-700">
        {done ? "Copied. Paste it into Confluence." : ""}
      </span>
      <Button size="sm" variant="primary" onClick={copy}>
        Copy for Confluence
      </Button>
      <Button size="sm" onClick={download}>
        Download CSV
      </Button>
    </div>
  );
}

/** Requirements → Export: the same menu as every Reports page. */
export function CoverageExport({ html, csv, fileName, exportTo }: { html: string; csv: string; fileName: string; exportTo: { url: string; cycle: boolean; preparedBy: string; scopeLine: string } }) {
  const plain = csv.replace(/"/g, "").replace(/,/g, "\t");
  return (
    <ExportMenu
      exportUrl={exportTo.url}
      view="requirements"
      viewLabel="Requirements"
      image={false}
      fileBase={fileName.replace(/\.csv$/, "")}
      tabs={exportTabs(exportTo.cycle).map((t) => ({ ...t, on: t.on || t.id === "requirements" }))}
      scopeLine={exportTo.scopeLine}
      preparedBy={exportTo.preparedBy}
      copy={() => copyRich(html, plain)}
      csv={() => {
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
        a.click();
        URL.revokeObjectURL(url);
      }}
    />
  );
}
