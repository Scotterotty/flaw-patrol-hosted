import { describe, expect, it } from "vitest";
import { capConnections, DEFAULT_POOL } from "./db-url";

describe("capConnections", () => {
  it("adds the default cap", () => {
    expect(capConnections("postgresql://u:p@db:5432/flawpatrol")).toBe(`postgresql://u:p@db:5432/flawpatrol?connection_limit=${DEFAULT_POOL}`);
  });
  it("keeps other settings in the address", () => {
    expect(capConnections("postgresql://u:p@db:5432/x?schema=public")).toBe(`postgresql://u:p@db:5432/x?schema=public&connection_limit=${DEFAULT_POOL}`);
  });
  it("leaves an address that already sets a cap alone", () => {
    expect(capConnections("postgresql://u:p@db/x?connection_limit=3")).toBe("postgresql://u:p@db/x?connection_limit=3");
  });
  it("uses DATABASE_POOL when it's a sensible number", () => {
    expect(capConnections("postgresql://u:p@db/x", "25")).toBe("postgresql://u:p@db/x?connection_limit=25");
    expect(capConnections("postgresql://u:p@db/x", "0")).toBe(`postgresql://u:p@db/x?connection_limit=${DEFAULT_POOL}`);
    expect(capConnections("postgresql://u:p@db/x", "lots")).toBe(`postgresql://u:p@db/x?connection_limit=${DEFAULT_POOL}`);
  });
  it("leaves a missing or unreadable address for Prisma to report", () => {
    expect(capConnections(undefined)).toBeUndefined();
    expect(capConnections("not a url")).toBe("not a url");
  });
});
