// Stand-ins for a company sign-in service and a mail server, used by ver92.spec.ts.
//  - Port 3195: OpenID Connect, shaped like Microsoft Entra (/<tenant>/v2.0) and a generic
//    single sign-on (/oidc). It signs in whoever POST /__as?email=… named last, with no prompt.
//  - Port 3194: a bare SMTP server that accepts any message; GET http://localhost:3195/__mail lists them.
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";

const port = Number(process.env.MOCK_SSO_PORT ?? 3195);
const smtpPort = Number(process.env.MOCK_SMTP_PORT ?? 3194);
const base = `http://localhost:${port}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
let as = { email: "admin@example.com", name: "Ada Admin", verified: true };
const codes = new Map();
const mail = [];

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function jwt(claims) {
  const head = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
  const body = b64(claims);
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

// "/<tenant>/v2.0" for the Microsoft-shaped one, "/oidc" for the generic one.
function issuerOf(path) {
  const ms = path.match(/^\/([0-9a-f-]{36})\/(v2\.0|oauth2\/v2\.0)/);
  if (ms) return { issuer: `${base}/${ms[1]}/v2.0`, prefix: `/${ms[1]}/oauth2/v2.0` };
  if (path.startsWith("/oidc")) return { issuer: `${base}/oidc`, prefix: "/oidc" };
  return null;
}

const body = (req) => new Promise((ok) => {
  let s = "";
  req.on("data", (c) => (s += c));
  req.on("end", () => ok(s));
});
const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const p = url.pathname;
    if (p === "/__as") {
      as = { email: url.searchParams.get("email"), name: url.searchParams.get("name") ?? "Someone", verified: url.searchParams.get("verified") !== "false" };
      return json(res, 200, as);
    }
    if (p === "/__mail") {
      if (req.method === "DELETE") mail.length = 0;
      return json(res, 200, mail);
    }
    if (p === "/keys") return json(res, 200, { keys: [jwk] });
    const iss = issuerOf(p);
    if (!iss) return json(res, 404, { error: "not found" });
    if (p.endsWith("/.well-known/openid-configuration")) {
      return json(res, 200, {
        issuer: iss.issuer,
        authorization_endpoint: `${base}${iss.prefix}/authorize`,
        token_endpoint: `${base}${iss.prefix}/token`,
        userinfo_endpoint: `${base}${iss.prefix}/userinfo`,
        jwks_uri: `${base}/keys`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (p.endsWith("/authorize")) {
      const code = randomBytes(12).toString("hex");
      codes.set(code, { ...as, issuer: iss.issuer, clientId: url.searchParams.get("client_id"), nonce: url.searchParams.get("nonce") });
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      if (url.searchParams.get("state")) back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (p.endsWith("/token")) {
      const form = new URLSearchParams(await body(req));
      const c = codes.get(form.get("code"));
      if (!c) return json(res, 400, { error: "invalid_grant" });
      codes.delete(form.get("code"));
      const now = Math.floor(Date.now() / 1000);
      const sub = `sub-${c.email}`;
      const ms = c.issuer.includes("/v2.0");
      const claims = { iss: c.issuer, aud: c.clientId, sub, iat: now, exp: now + 600, name: c.name, ...(c.nonce ? { nonce: c.nonce } : {}) };
      // Entra puts the work email in preferred_username; the generic one says whether it's verified.
      Object.assign(claims, ms ? { preferred_username: c.email } : { email: c.email, email_verified: c.verified });
      return json(res, 200, { access_token: `at-${sub}`, token_type: "Bearer", expires_in: 600, id_token: jwt(claims) });
    }
    if (p.endsWith("/userinfo")) return json(res, 200, { sub: `sub-${as.email}`, email: as.email, name: as.name, email_verified: as.verified });
    json(res, 404, { error: "not found" });
  })
  .listen(port, () => console.log(`mock SSO on ${port}`));

// Just enough SMTP for nodemailer: no TLS, no login.
net
  .createServer((sock) => {
    let data = false;
    let msg = { from: "", to: [], raw: "" };
    let buf = "";
    sock.write("220 mock.smtp ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === ".") {
            data = false;
            const subject = /^Subject: (.*)$/im.exec(msg.raw)?.[1] ?? "";
            mail.push({ from: msg.from, to: msg.to, subject, raw: msg.raw });
            msg = { from: "", to: [], raw: "" };
            sock.write("250 OK queued\r\n");
          } else msg.raw += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-mock.smtp\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL") (msg.from = /<(.*)>/.exec(line)?.[1] ?? ""), sock.write("250 OK\r\n");
        else if (cmd === "RCPT") msg.to.push(/<(.*)>/.exec(line)?.[1] ?? ""), sock.write("250 OK\r\n");
        else if (cmd === "DATA") (data = true), sock.write("354 End with .\r\n");
        else if (cmd === "QUIT") sock.end("221 Bye\r\n");
        else if (cmd === "RSET" || cmd === "NOOP") sock.write("250 OK\r\n");
        else sock.write("502 Not implemented\r\n");
      }
    });
    sock.on("error", () => {});
  })
  .listen(smtpPort, () => console.log(`mock SMTP on ${smtpPort}`));
