// A tiny stand-in for Sentry's read API (ver_96), so e2e tests can connect Sentry and see
// errors next to a failed step without a real Sentry. Token "good-token" works; any other is refused.
import http from "node:http";

const port = Number(process.env.MOCK_SENTRY_PORT ?? 3193);
const now = () => new Date().toISOString();
const ISSUES = [
  { id: "9001", shortId: "APP-IOS-3F2", title: "TypeError: Cannot read properties of undefined (reading 'last4')", culprit: "PaymentSheet.confirm", project: { slug: "mobile-ios" }, count: "14" },
  { id: "9002", shortId: "API-7Q", title: "HTTP 502 POST /v2/orders", culprit: "orders.create", project: { slug: "api" }, count: "3", old: true },
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer good-token") return send(401, { detail: "Invalid token" });
    const p = url.pathname.replace(/^\/api\/0/, "");
    if (p === "/") return send(200, { user: { email: "alex@example.com" } });
    if (p === "/organizations/") return send(200, [{ slug: "acme", name: "Acme" }]);
    if (/^\/organizations\/acme\/projects\/$/.test(p))
      return send(200, [
        { id: "11", slug: "mobile-ios", name: "Mobile iOS" },
        { id: "12", slug: "api", name: "API" },
      ]);
    if (/^\/projects\/acme\/[\w-]+\/environments\/$/.test(p)) return send(200, [{ name: "staging" }, { name: "production" }]);
    if (p === "/organizations/acme/releases/") return send(200, [{ version: `mobile-ios@${url.searchParams.get("query")}+812` }]);
    if (p === "/organizations/acme/issues/") {
      const q = url.searchParams.get("query") ?? "";
      if (q.includes("first-release:")) return send(200, ISSUES.slice(0, 1).map((i) => ({ ...i, permalink: `http://localhost:${port}/issues/${i.id}/`, firstSeen: now(), lastSeen: now() })));
      // The app doesn't send user emails: only-mine searches find nothing, so Flaw Patrol falls back to everyone's.
      if (q.includes("user.email:")) return send(200, []);
      // Status's Sentry card (ver_258): errors in the last day from no build, and from builds nobody is testing.
      if (q.startsWith("!has:release")) return send(200, ISSUES.slice(1).map((i) => ({ ...i, permalink: `http://localhost:${port}/issues/${i.id}/`, firstSeen: now(), lastSeen: now() })));
      return send(
        200,
        ISSUES.map((i) => ({ ...i, permalink: `http://localhost:${port}/organizations/acme/issues/${i.id}/`, firstSeen: i.old ? "2026-10-01T10:00:00Z" : now(), lastSeen: now() })),
      );
    }
    if (/^\/issues\/\d+\/events\/latest\/$/.test(p))
      return send(200, {
        entries: [
          {
            type: "exception",
            data: { values: [{ stacktrace: { frames: [{ function: "onPress", filename: "Button.tsx", lineNo: 41, inApp: true }, { function: "PaymentSheet.confirm", filename: "PaymentSheet.tsx", lineNo: 88, inApp: true }] } }] },
          },
        ],
      });
    if (p === "/organizations/acme/sessions/") return send(200, { groups: [{ totals: { "crash_free_rate(session)": 0.986 } }] });
    send(404, { detail: "Not found" });
  })
  .listen(port, () => console.log(`mock Sentry on ${port}`));
