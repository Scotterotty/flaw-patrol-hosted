import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { allowedHosts, assertOutbound, isBlockedAddress, jiraHostProblem, OutboundBlocked } = await import("./outbound");

const prod = { production: true, allow: new Set<string>() };
const resolvesTo = (...ips: string[]) => ({ ...prod, resolve: async () => ips });

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe", "not an ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "104.192.141.1", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("assertOutbound", () => {
  it("allows a public https address", async () => {
    await expect(assertOutbound("https://acme.atlassian.net", "Jira", resolvesTo("104.192.141.1"))).resolves.toBeInstanceOf(URL);
  });
  it("blocks names that resolve to an internal address, even one of several", async () => {
    await expect(assertOutbound("https://evil.example.com", "Jira", resolvesTo("104.192.141.1", "10.0.0.5"))).rejects.toThrow(/internal network address.*OUTBOUND_ALLOW_HOSTS/);
  });
  it("blocks the cloud metadata server and cluster names without looking them up", async () => {
    const never = { ...prod, resolve: async () => { throw new Error("looked up"); } };
    await expect(assertOutbound("https://169.254.169.254/latest", "Sentry", never)).rejects.toBeInstanceOf(OutboundBlocked);
    await expect(assertOutbound("https://api.default.svc.cluster.local", "Sentry", never)).rejects.toThrow(/internal network address/);
    await expect(assertOutbound("https://[::1]:8080", "Sentry", never)).rejects.toThrow(/internal/);
  });
  it("needs https, and no name or password in the address", async () => {
    await expect(assertOutbound("http://sentry.example.com", "Sentry", resolvesTo("8.8.8.8"))).rejects.toThrow(/https/);
    await expect(assertOutbound("https://a:b@sentry.example.com", "Sentry", resolvesTo("8.8.8.8"))).rejects.toThrow(/name and password/);
    await expect(assertOutbound("file:///etc/passwd", "Sentry", resolvesTo("8.8.8.8"))).rejects.toThrow(/https/);
  });
  it("lets through hosts IT allowed, and localhost outside production", async () => {
    await expect(assertOutbound("http://teamcity.corp:8111", "TeamCity", { production: true, allow: allowedHosts(" TeamCity.corp ,x") })).resolves.toBeInstanceOf(URL);
    await expect(assertOutbound("http://localhost:3199", "Jira", { production: false, allow: new Set() })).resolves.toBeInstanceOf(URL);
    await expect(assertOutbound("http://localhost:3199", "Jira", prod)).rejects.toThrow();
  });
  it("says so plainly when the name doesn't exist", async () => {
    await expect(assertOutbound("https://nope.example", "Jira", { ...prod, resolve: async () => { throw new Error("ENOTFOUND"); } })).rejects.toThrow("Couldn't find nope.example. Check the Jira address.");
  });
});

describe("jiraHostProblem", () => {
  it("allows Jira Cloud sites", () => {
    expect(jiraHostProblem("https://acme.atlassian.net", new Set(), true)).toBeNull();
    expect(jiraHostProblem("https://acme.jira.com", new Set(), true)).toBeNull();
  });
  it("turns away other hosts unless IT allowed them", () => {
    expect(jiraHostProblem("https://evil.example.com", new Set(), true)).toMatch(/atlassian\.net.*OUTBOUND_ALLOW_HOSTS/);
    expect(jiraHostProblem("https://jira.example.com", new Set(["jira.example.com"]), true)).toBeNull();
    expect(jiraHostProblem("http://acme.atlassian.net", new Set(), true)).not.toBeNull();
    expect(jiraHostProblem("https://atlassian.net.evil.com", new Set(), true)).not.toBeNull();
  });
});
