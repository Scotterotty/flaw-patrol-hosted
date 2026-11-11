// A tiny stand-in for Jira Cloud's REST API so the e2e tests can file and link
// bugs without a real site. GET /__issues returns everything created.
import http from "node:http";

const port = Number(process.env.MOCK_JIRA_PORT ?? 3199);
// Like the team's site: a custom Severity field (A to E), and Priority set by producers.
const SEVERITY = "customfield_10050";
const issues = new Map([["QA-7", { summary: "Checkout button unresponsive on Safari", status: "In Progress", category: "indeterminate", attachments: 0, severity: "B - Critical", priority: "Blocker" }]]);
const seq = { QA: 100, RP: 100, OB: 5000, BB: 100 };
// Project OB has the team's bug template fields, like OB-5292. Bug Workaround is
// on neither screen so the description has to carry it. Like the team's real site
// (ver_143), Severity is only on the Edit screen and Priority is required.
const opt = (...values) => values.map((value, i) => ({ id: String(10000 + i), value }));
const PRIORITIES = ["Highest", "High", "Medium", "Low", "Not Prioritized"].map((name, i) => ({ id: String(i + 1), name }));
const SEVERITY_FIELD = { fieldId: SEVERITY, name: "Severity", required: false, schema: { type: "option", custom: "x:select" }, allowedValues: opt("A - Showstopper", "B - Critical", "C - Problematic", "D - Minor", "E - Enhancement") };
const OB_FIELDS = [
  { fieldId: "summary", name: "Summary", required: true, schema: { type: "string", system: "summary" } },
  { fieldId: "description", name: "Description", required: false, schema: { type: "string", system: "description" } },
  { fieldId: "reporter", name: "Reporter", required: true, schema: { type: "user", system: "reporter" } },
  { fieldId: "priority", name: "Priority", required: true, schema: { type: "priority", system: "priority" }, allowedValues: PRIORITIES },
  { fieldId: "customfield_11427", name: "Client/SKUs", required: true, schema: { type: "array", items: "option", custom: "x:multicheckboxes" }, allowedValues: opt("CHS", "CSP", "Unity", "Unreal", "Web", "Windows") },
  { fieldId: "customfield_11461", name: "Team", required: true, schema: { type: "option", custom: "x:radiobuttons" }, allowedValues: opt("Web", "CHS", "CSP", "Solutions", "Unity", "Unreal", "Nodey") },
  { fieldId: "customfield_11490", name: "Repro Rate", required: false, schema: { type: "string", custom: "x:textfield" } },
  { fieldId: "customfield_11489", name: "Build #", required: true, schema: { type: "string", custom: "x:textfield" } },
  { fieldId: "customfield_11428", name: "Oly Environment", required: false, schema: { type: "array", items: "option", custom: "x:multicheckboxes" }, allowedValues: opt("o2Dev", "o2QA", "o2Stage", "o2Prod") },
  { fieldId: "customfield_11323", name: "Repro Steps", required: true, schema: { type: "string", custom: "x:textarea" } },
  { fieldId: "customfield_11377", name: "OKO Space Link", required: false, schema: { type: "string", custom: "x:textarea" } },
  { fieldId: "customfield_11494", name: "Bug Impact", required: false, schema: { type: "string", custom: "x:textarea" } },
  { fieldId: "customfield_11512", name: "Last Reproduced", required: false, schema: { type: "date", custom: "x:datepicker" } },
];
// /__oko-strict/on (ver_220): the team's real Jira, where all 7 OKO fields are required.
let okoStrict = false;
const STRICT_REQUIRED = new Set(["customfield_11377", "customfield_11494", "customfield_11513"]);
const WORKAROUND = { fieldId: "customfield_11513", name: "Bug Workaround", required: true, schema: { type: "string", custom: "x:textarea" } };
const obFields = () => (okoStrict ? [...OB_FIELDS.map((f) => (STRICT_REQUIRED.has(f.fieldId) ? { ...f, required: true } : f)), WORKAROUND] : OB_FIELDS);
// More of OB-5292's fields, also only on the Edit screen.
const OB_EDIT = [
  ...OB_FIELDS,
  SEVERITY_FIELD,
  { fieldId: "customfield_11600", name: "Stakeholder Priority", required: false, schema: { type: "option", custom: "x:select" }, allowedValues: opt("P1", "P2", "P3", "Not Prioritized") },
  { fieldId: "customfield_11601", name: "To Be Automated?", required: false, schema: { type: "option", custom: "x:select" }, allowedValues: opt("Yes", "No", "Maybe") },
  { fieldId: "customfield_11602", name: "Status update", required: false, schema: { type: "option", custom: "x:select" }, allowedValues: opt("Not Started", "In Progress", "Done") },
];
const BASIC_FIELDS = [
  ...OB_FIELDS.slice(0, 3).map((f) => ({ ...f, required: f.fieldId === "summary" })),
  SEVERITY_FIELD,
  { fieldId: "priority", name: "Priority", required: false, schema: { type: "priority", system: "priority" }, allowedValues: PRIORITIES },
  // A plain team layout, for importing a bug template from an example bug (QA-418).
  { fieldId: "components", name: "Component", required: false, schema: { type: "array", items: "component", system: "components" }, allowedValues: [{ id: "1", name: "Mobile app" }, { id: "2", name: "Web app" }] },
  { fieldId: "customfield_12001", name: "Reproducibility", required: false, schema: { type: "option", custom: "x:select" }, allowedValues: opt("Always", "Sometimes", "Once") },
  { fieldId: "versions", name: "Found in version", required: false, schema: { type: "array", items: "version", system: "versions" }, allowedValues: [{ id: "1", name: "4.12" }] },
  { fieldId: "labels", name: "Labels", required: false, schema: { type: "array", items: "string", system: "labels" } },
];
const b = (t) => ({ type: "paragraph", content: [{ type: "text", text: t, marks: [{ type: "strong" }] }] });
const p_ = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
issues.set("QA-418", {
  summary: "[MOBILE] - Login - Password field hides the Show button",
  status: "To Do",
  category: "new",
  attachments: 0,
  fields: {
    project: { key: "QA" },
    components: [{ name: "Mobile app" }],
    customfield_12001: { value: "Always" },
    versions: [{ name: "4.12" }],
    labels: ["login"],
    assignee: { accountId: "acc-bot" },
  },
  description: {
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Steps to Reproduce" }] },
      p_("1. Open the app"),
      b("Expected Result:"),
      p_("Show button stays"),
      b("Actual Result:"),
      p_("It hides"),
      b("Environment"),
      p_("iPhone 15"),
      b("Notes"),
      p_("None"),
    ],
  },
});
// An old bug like OB-5292 (numbered below new ones), so Jira can say what OB's Edit screen has.
issues.set("OB-4292", { summary: "[CLIENT(S)] - Feature - Brief Summary of Issue...", status: "Closed", category: "done", attachments: 0, severity: "B - Critical", priority: "Not Prioritized" });
// Stories for story links (ver_82): Story and Task issues in QA, with Jira releases (fixVersions).
const story = (summary, status, category, type, fixVersions) => ({ summary, status, category, attachments: 0, type, fixVersions });
issues.set("QA-201", story("Join a space from an invite link", "Done", "done", "Story", ["RC 22"]));
issues.set("QA-202", story("Invite links expire after 7 days", "In Progress", "indeterminate", "Story", ["RC 22"]));
issues.set("QA-203", story("Space thumbnails load lazily", "To Do", "new", "Story", ["RC 22"]));
issues.set("QA-204", story("Voice chat push to talk", "To Do", "new", "Task", ["RC 23"]));
issues.set("QA-205", story("Old onboarding epic", "Done", "done", "Epic", ["RC 21"]));
// Requirements (ver_89): a custom Requirement type, and an Epic whose children are QA-201 and QA-202.
issues.set("QA-206", story("Invite links work offline", "To Do", "new", "Requirement", ["RC 22"]));
issues.set("QA-210", story("Invites epic", "In Progress", "indeterminate", "Epic", ["RC 22"]));
issues.get("QA-201").parent = "QA-210";
issues.get("QA-202").parent = "QA-210";
// Risk board (ver_93): priorities and story points for the first guess.
Object.assign(issues.get("QA-202"), { priority: "High", points: 8 });
Object.assign(issues.get("QA-203"), { priority: "Low", points: 2 });
Object.assign(issues.get("QA-206"), { priority: "Highest", points: 5 });
// Several requirement projects (ver_161): WEB has its own stories, one in RC 22 like QA, one in "Web 22".
issues.set("WEB-41", story("Share a space link on the web", "To Do", "new", "Story", ["RC 22"]));
issues.set("WEB-42", story("Web sign-in page", "In Progress", "indeterminate", "Story", ["Web 22"]));
Object.assign(issues.get("WEB-42"), { priority: "Highest", points: 8 });
// Every issue type (Fix Version across boards): WEB tickets in RC 22 that aren't Stories or Tasks.
issues.set("WEB-43", story("Faster lobby load", "To Do", "new", "Improvement", ["RC 22"]));
issues.set("WEB-44", story("Lobby load: profile the asset bundle", "To Do", "new", "Sub-task", ["RC 22"]));
// Bug board (ver_211): project BB has a Kanban board with the team's columns, like the OB board.
// Its saved filter is the whole project; Done statuses sit in a column the board leaves out.
const STATUSES = [
  ["1", "New", "new"],
  ["2", "Open", "indeterminate"],
  ["3", "Reopened", "indeterminate"],
  ["4", "Blocked", "indeterminate"],
  ["5", "Needs QA", "indeterminate"],
  ["6", "In Test", "indeterminate"],
  ["9", "Closed", "done"],
].map(([id, name, key]) => ({ id, name, statusCategory: { key } }));
const statusId = (name) => STATUSES.find((s) => s.name === name)?.id;
const BB_COLUMNS = [
  { name: "New", statuses: [{ id: "1" }] },
  { name: "Open / Reopen", statuses: [{ id: "2" }, { id: "3" }] },
  { name: "Blocked / NMI", statuses: [{ id: "4" }] },
  { name: "Needs QA", statuses: [{ id: "5" }] },
  { name: "In test", statuses: [{ id: "6" }] },
  { name: "Done", statuses: [{ id: "9" }] },
];
const person = (displayName, emailAddress) => ({ displayName, emailAddress });
const adf = (...lines) => ({ type: "doc", version: 1, content: lines.map((t) => (typeof t === "string" ? p_(t) : t)) });
const bb = (n, summary, status, priority, extra = {}) =>
  issues.set(`BB-${n}`, { summary, status, category: STATUSES.find((s) => s.name === status).statusCategory.key, attachments: 0, priority, fields: { labels: [], versions: [], created: "2026-11-02T18:14:00.000+0000", reporter: person("Priya Patel", "priya@example.com"), comment: { comments: [] }, attachment: [], ...extra } });
bb(1, "Clone button does nothing on second try", "New", "High", { labels: ["Support Duty"], assignee: null });
bb(2, "Panel background wrong when viewed on phone", "Open", "Medium", { assignee: person("Jordan Lee", "jordan@example.com"), versions: [{ name: "2.4.2" }] });
bb(3, "Material list splits after another user edits", "Needs QA", "Medium", {
  assignee: person("Demo Admin", "admin@example.com"),
  labels: ["UE_Materials", "goal-support", "priority-6"],
  versions: [{ name: "2.4.2" }],
  fixVersions: [{ name: "2.4.3" }],
  comment: {
    comments: [
      { id: "11", author: person("Priya Patel"), created: "2026-11-06T17:00:00.000+0000", body: adf("Also happens on Unity.") },
      { id: "12", author: person("Sam Rivera"), created: "2026-11-08T17:00:00.000+0000", body: adf("Fixed in build 4.21. Moving to Needs QA.") },
    ],
  },
  attachment: [
    { id: "7001", filename: "split-list.png", size: 2048, mimeType: "image/png" },
    { id: "7002", filename: "client.log", size: 52000, mimeType: "text/plain" },
  ],
});
issues.get("BB-3").description = adf(
  "Material list splits into two lists when another user renames a material.",
  { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Steps to reproduce" }] },
  { type: "orderedList", content: ["Open a space with two users signed in.", "User B renames any material."].map((t) => ({ type: "listItem", content: [p_(t)] })) },
);
// Like OB: repro steps in their own field, plus Build # and an empty Bug Impact (ver_212).
Object.assign(issues.get("BB-3").fields, {
  customfield_11323: adf({ type: "orderedList", content: ["Sign in as two users in the same space.", "As User B, rename any material.", "Look at User A's material list."].map((t) => ({ type: "listItem", content: [p_(t)] })) }),
  customfield_11489: "4.20.1",
  customfield_11490: "3/3",
  customfield_11494: null,
  customfield_10019: "0|i0001:",
});
bb(4, "Typing indicator shows for the wrong user", "Blocked", "Low", { labels: ["UE_Materials"] });
bb(5, "Old crash on exit", "Closed", "High");
// 55 open bugs in New, so the board shows 50 and Show more.
for (let n = 10; n < 65; n++) bb(n, `Lobby glitch number ${n}`, "New", "Low");
const BOARD_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const ISSUE_TYPES = ["Bug", "Story", "Task", "Epic", "Requirement"].map((name) => ({ name, subtask: false, hierarchyLevel: name === "Epic" ? 1 : 0 })).concat([{ name: "Sub-task", subtask: true, hierarchyLevel: -1 }]);
const VERSIONS = ["RC 21", "RC 22", "RC 23"];
// Each project's releases, oldest first like Jira. WEB names one release its own way.
const PROJECT_VERSIONS = { WEB: ["RC 22", "Web 22"] };
const links = [];
const slack = [];
let attachmentSeq = 900;
// Jira people, found by email. Reporter can be set only while canModifyReporter is on.
const users = [
  { accountId: "acc-admin", displayName: "Demo Admin", emailAddress: "admin@example.com" },
  { accountId: "acc-bot", displayName: "QA Bot", emailAddress: "qa-bot@example.com" },
  { accountId: "acc-hidden", displayName: "Hidden Email Person" },
];
let canModifyReporter = true;

const send = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const raw = (key) => {
  const i = issues.get(key);
  return {
    key,
    fields: {
      summary: i.summary,
      status: { id: statusId(i.status), name: i.status, statusCategory: { key: i.category } },
      priority: { name: i.priority ?? "Not Prioritized" },
      [SEVERITY]: i.severity ? { value: i.severity } : null,
      issuetype: { name: i.type ?? "Bug" },
      fixVersions: (i.fixVersions ?? []).map((name) => ({ name })),
      parent: i.parent ? { key: i.parent } : null,
      customfield_10016: i.points ?? null,
      ...(i.fields ?? {}),
      description: i.description ?? null,
    },
  };
};

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__issues") return send(res, 200, Object.fromEntries(issues));
    if (p === "/__links") return send(res, 200, links);
    // A stand-in Slack incoming webhook (ver_82): /slack/<anything> takes messages, /__slack lists them.
    if (p.startsWith("/slack/") && req.method === "POST") {
      if (p.endsWith("/gone")) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("no_service");
      }
      slack.push({ hook: p, ...JSON.parse(body.toString() || "{}") });
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    if (p === "/__slack") return send(res, 200, slack);
    const strict = /^\/__oko-strict\/(on|off)$/.exec(p);
    if (strict) {
      okoStrict = strict[1] === "on";
      return send(res, 204);
    }
    const perm = /^\/__reporter\/(on|off)$/.exec(p);
    if (perm) {
      canModifyReporter = perm[1] === "on";
      return send(res, 204);
    }
    // Test hooks: close an issue, or delete one as if it had been removed in Jira.
    const hook = /^\/__(close|delete)\/([^/]+)$/.exec(p);
    if (hook) {
      if (hook[1] === "delete") issues.delete(hook[2]);
      else Object.assign(issues.get(hook[2]), { status: "Closed", category: "done" });
      return send(res, 204);
    }
    if (!String(req.headers.authorization ?? "").startsWith("Basic ")) return send(res, 401, { errorMessages: ["Unauthorized"] });
    if (p === "/rest/api/3/myself") return send(res, 200, { accountId: "acc-bot", displayName: "QA Bot", emailAddress: "qa-bot@example.com" });
    if (p === "/rest/api/3/field") return send(res, 200, [{ id: "summary", name: "Summary" }, { id: SEVERITY, name: "Severity" }, { id: "customfield_10016", name: "Story point estimate" }]);
    if (p === "/rest/api/3/user/search") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      // Like Jira: people whose email is hidden still match their exact email, but it isn't returned.
      if (q === "hidden@example.com") return send(res, 200, [{ accountId: "acc-hidden", accountType: "atlassian", active: true, displayName: "Hidden Email Person" }]);
      return send(res, 200, users.filter((u) => u.emailAddress?.startsWith(q)).map((u) => ({ ...u, accountType: "atlassian", active: true })));
    }
    if (p === "/rest/api/3/mypermissions") return send(res, 200, { permissions: { MODIFY_REPORTER: { havePermission: canModifyReporter } } });
    const versions = /^\/rest\/api\/3\/project\/([^/]+)\/versions$/.exec(p);
    if (versions) return send(res, 200, (PROJECT_VERSIONS[versions[1]] ?? VERSIONS).map((name, i) => ({ id: String(i + 1), name, released: i < 1, archived: false })));
    if (p === "/rest/api/3/issueLink" && req.method === "POST") {
      const { inwardIssue, outwardIssue, type } = JSON.parse(body.toString());
      if (!issues.has(inwardIssue?.key) || !issues.has(outwardIssue?.key)) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      links.push({ type: type?.name, from: inwardIssue.key, to: outwardIssue.key });
      return send(res, 201);
    }
    // Bug board (ver_211): Jira Software's board list and setup, saved filters and statuses.
    if (p === "/rest/agile/1.0/board") return send(res, 200, { values: url.searchParams.get("projectKeyOrId") === "BB" ? [{ id: 7, name: "BB board", type: "kanban" }] : [] });
    if (p === "/rest/agile/1.0/board/7/configuration") return send(res, 200, { filter: { id: "700" }, columnConfig: { columns: BB_COLUMNS } });
    if (p === "/rest/api/3/filter/700") return send(res, 200, { id: "700", jql: 'project = "BB" ORDER BY Rank ASC' });
    if (p === "/rest/api/3/status") return send(res, 200, STATUSES);
    if (p.startsWith("/rest/api/3/project/")) return /\/(QA|RP|OB|WEB|BB)$/.test(p) ? send(res, 200, { key: "QA", issueTypes: ISSUE_TYPES }) : send(res, 404, { errorMessages: ["No project"] });
    if (p === "/rest/api/3/issuetype") return send(res, 200, ISSUE_TYPES);
    const meta = /^\/rest\/api\/3\/issue\/createmeta\/([^/]+)\/issuetypes(?:\/(\w+))?$/.exec(p);
    if (meta) {
      if (!meta[2]) return send(res, 200, { issueTypes: [{ id: "1", name: "Bug" }], total: 1 });
      const fields = meta[1] === "OB" ? obFields() : BASIC_FIELDS;
      return send(res, 200, { fields, total: fields.length, startAt: 0, maxResults: 200 });
    }
    // Like a Jira Cloud site: it says it takes 1 GB, while the team's really refuses files over 24 MB (ver_185).
    if (p === "/rest/api/3/attachment/meta") return send(res, 200, { enabled: true, uploadLimit: 1024 ** 3 });
    const content = /^\/rest\/api\/3\/attachment\/content\/(\d+)$/.exec(p);
    if (content && Number(content[1]) >= 7000) {
      res.writeHead(200, { "Content-Type": content[1] === "7001" ? "image/png" : "text/plain" });
      return res.end(content[1] === "7001" ? BOARD_PNG : "log line 1\n");
    }
    if (content) {
      res.writeHead(303, { Location: `https://api.media.atlassian.com/file/00000000-0000-4000-8000-${content[1].padStart(12, "0")}/binary?token=x` });
      return res.end();
    }
    if (p === "/rest/api/3/search/jql") {
      const { jql } = JSON.parse(body.toString() || "{}");
      const m = /text ~ "([^"*]*)\*?"/.exec(jql ?? "");
      const keyIn = /key in \(([^)]*)\)/.exec(jql ?? "");
      const parentIn = /parent in \(([^)]*)\)/.exec(jql ?? "");
      let keys = [...issues.keys()];
      if (keyIn) {
        keys = keyIn[1].split(",").map((k) => k.trim().replace(/"/g, ""));
        // Like Jira, one missing key fails the whole search.
        const missing = keys.find((k) => !issues.has(k));
        if (missing) return send(res, 400, { errorMessages: [`An issue with key '${missing}' does not exist for field 'key'.`] });
      }
      else if (parentIn) {
        const parents = parentIn[1].split(",").map((k) => k.trim().replace(/"/g, ""));
        keys = keys.filter((k) => parents.includes(issues.get(k).parent));
      } else {
        const proj = /project = "([^"]+)"/.exec(jql ?? "");
        const projIn = /project in \(([^)]*)\)/.exec(jql ?? "");
        const fixIn = /fixVersion in \(([^)]*)\)/.exec(jql ?? "");
        const list = (m) => m[1].split(",").map((t) => t.trim().replace(/"/g, ""));
        const types = /issuetype in \(([^)]*)\)/.exec(jql ?? "");
        const fix = /fixVersion = "([^"]+)"/.exec(jql ?? "");
        const keyEq = /key = "([^"]+)"/.exec(jql ?? "");
        if (proj) keys = keys.filter((k) => k.startsWith(`${proj[1]}-`));
        if (projIn) keys = keys.filter((k) => list(projIn).includes(k.split("-")[0]));
        if (fixIn) keys = keys.filter((k) => (issues.get(k).fixVersions ?? []).some((v) => list(fixIn).includes(v)));
        if (types) {
          const list = types[1].split(",").map((t) => t.trim().replace(/"/g, ""));
          keys = keys.filter((k) => list.includes(issues.get(k).type ?? "Bug"));
        }
        // Every issue type: Jira's subTaskIssueTypes() leaves Sub-tasks out.
        if (/issuetype not in subTaskIssueTypes\(\)/.test(jql ?? "")) keys = keys.filter((k) => !/^sub-?task$/i.test(issues.get(k).type ?? "Bug"));
        if (fix) keys = keys.filter((k) => (issues.get(k).fixVersions ?? []).includes(fix[1]));
        const statusIn = /status in \(([^)]*)\)/.exec(jql ?? "");
        if (statusIn) keys = keys.filter((k) => list(statusIn).includes(statusId(issues.get(k).status)));
        if (keyEq && issues.has(keyEq[1]) && keys.includes(keyEq[1])) keys = [keyEq[1]];
        else if (m) keys = keys.filter((k) => issues.get(k).summary.toLowerCase().includes(m[1].toLowerCase()));
        if (/ORDER BY key ASC/.test(jql ?? "")) keys.sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
      }
      // Like Jira, results come in pages (Jira's limit is 100; 5 here so paging gets tested, ver_161).
      const { maxResults, nextPageToken } = JSON.parse(body.toString() || "{}");
      const at = Number(nextPageToken ?? 0) || 0;
      const size = Math.min(5, maxResults ?? 50);
      const page = keys.slice(at, at + size);
      const more = at + size < keys.length;
      return send(res, 200, { issues: page.map(raw), isLast: !more, ...(more ? { nextPageToken: String(at + size) } : {}) });
    }
    if (p === "/rest/api/3/issue" && req.method === "POST") {
      const { fields } = JSON.parse(body.toString());
      if (fields.reporter && !canModifyReporter) return send(res, 400, { errors: { reporter: "Field 'reporter' cannot be set. It is not on the appropriate screen, or unknown." } });
      const proj = fields.project?.key in seq ? fields.project.key : "QA";
      // Like Jira: unknown fields, options it doesn't list, and missing required fields refuse the whole issue.
      if (proj === "OB") {
        const errors = {};
        for (const [id, v] of Object.entries(fields)) {
          if (["project", "issuetype", "summary", "description", "reporter"].includes(id)) continue;
          const f = obFields().find((x) => x.fieldId === id);
          if (!f) errors[id] = `Field '${id}' cannot be set. It is not on the appropriate screen, or unknown.`;
          else if (f.allowedValues && ![v].flat().every((o) => f.allowedValues.some((a) => (a.value ?? a.name) === (o?.value ?? o?.name)))) errors[id] = `Specify a valid value for ${f.name}`;
        }
        for (const f of obFields()) if (f.required && f.fieldId !== "reporter" && !fields[f.fieldId]) errors[f.fieldId] = `${f.name} is required.`;
        if (Object.keys(errors).length) return send(res, 400, { errorMessages: [], errors });
      }
      const key = `${proj}-${++seq[proj]}`;
      issues.set(key, { summary: fields.summary, status: "To Do", category: "new", attachments: 0, files: [], priority: fields.priority?.name, severity: fields[SEVERITY]?.value, description: fields.description, reporter: fields.reporter?.id ?? null, fields });
      return send(res, 201, { key });
    }
    const att = /^\/rest\/api\/3\/issue\/([^/]+)\/attachments$/.exec(p);
    if (att && issues.has(att[1])) {
      if (body.length > 24 * 1024 * 1024) return send(res, 413, { errorMessages: ["The file is too large."] });
      const names = [...body.toString("latin1").matchAll(/filename="([^"]*)"/g)].map((m) => m[1]);
      const i = issues.get(att[1]);
      i.attachments += names.length;
      const added = names.map((filename) => ({ id: String(++attachmentSeq), filename }));
      i.files = [...(i.files ?? []), ...added.map((a) => a.filename)];
      return send(res, 200, added);
    }
    const edit = /^\/rest\/api\/3\/issue\/([^/]+)\/editmeta$/.exec(p);
    if (edit) {
      if (!issues.has(edit[1])) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      const list = edit[1].startsWith("OB-") ? OB_EDIT : BASIC_FIELDS;
      return send(res, 200, { fields: Object.fromEntries(list.filter((f) => f.fieldId !== "reporter").map(({ fieldId, ...f }) => [fieldId, { ...f, key: fieldId }])) });
    }
    const one = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(p);
    if (one && req.method === "PUT") {
      if (!issues.has(one[1])) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      // Like Jira for anyone but an admin: turning off the update email is refused.
      if (url.searchParams.get("notifyUsers") === "false") return send(res, 400, { errorMessages: ["To discard the user notification either admin or project admin permissions are required."] });
      const { fields } = JSON.parse(body.toString());
      const i = issues.get(one[1]);
      // Like Jira: only fields on the Edit screen, with a value it lists.
      if (one[1].startsWith("OB-")) {
        const errors = {};
        for (const [id, v] of Object.entries(fields)) {
          const f = OB_EDIT.find((x) => x.fieldId === id);
          if (!f) errors[id] = `Field '${id}' cannot be set. It is not on the appropriate screen, or unknown.`;
          else if (f.allowedValues && ![v].flat().every((o) => f.allowedValues.some((a) => (a.value ?? a.name) === (o?.value ?? o?.name)))) errors[id] = `Specify a valid value for ${f.name}`;
        }
        if (Object.keys(errors).length) return send(res, 400, { errorMessages: [], errors });
      }
      if (fields.description) i.description = fields.description;
      if (fields[SEVERITY]) i.severity = fields[SEVERITY].value;
      if (fields.priority) i.priority = fields.priority.name;
      const rest = Object.fromEntries(Object.entries(fields).filter(([id]) => id !== "description"));
      if (Object.keys(rest).length) i.fields = { ...(i.fields ?? {}), ...rest };
      return send(res, 204);
    }
    if (one && (url.searchParams.get("expand") ?? "").split(",").includes("names")) {
      if (!issues.has(one[1])) return send(res, 404, { errorMessages: ["Issue does not exist"] });
      const names = { ...Object.fromEntries([...OB_FIELDS, ...BASIC_FIELDS].map((f) => [f.fieldId, f.name])), ...(one[1].startsWith("BB-") ? { customfield_10019: "Rank" } : {}) };
      const schema = { customfield_10019: { type: "any", custom: "com.pyxis.greenhopper.jira:gh-lexo-rank" } };
      const r = raw(one[1]);
      return send(res, 200, { ...r, fields: { project: { key: one[1].split("-")[0] }, ...r.fields }, names, schema });
    }
    if (one) return issues.has(one[1]) ? send(res, 200, raw(one[1])) : send(res, 404, { errorMessages: ["Issue does not exist"] });
    send(res, 404, { errorMessages: [`Not mocked: ${req.method} ${p}`] });
  })
  .listen(port, () => console.log(`mock Jira on ${port}`));
