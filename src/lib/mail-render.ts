// How Flaw Patrol emails look (ver_92): a plain text version and a small HTML one.

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Mail = { to: string; subject: string; lines: string[]; button?: { label: string; url: string }; footer?: string };

/** Plain text and a small HTML version of the same message. */
export function renderMail(m: Mail) {
  const text = [...m.lines, ...(m.button ? ["", `${m.button.label}: ${m.button.url}`] : []), ...(m.footer ? ["", m.footer] : [])].join("\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#1d1a2b;max-width:520px">`,
    ...m.lines.map((l) => `<p style="margin:0 0 12px">${escape(l)}</p>`),
    m.button ? `<p style="margin:18px 0"><a href="${escape(m.button.url)}" style="background:#7442c8;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;display:inline-block;font-weight:600">${escape(m.button.label)}</a></p>` : "",
    m.footer ? `<p style="margin:0;color:#6a6680;font-size:12.5px">${escape(m.footer)}</p>` : "",
    `</div>`,
  ].join("");
  return { text, html };
}
