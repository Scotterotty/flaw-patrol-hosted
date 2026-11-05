import { describe, expect, it } from "vitest";
import { duplicateMessage } from "./duplicate-message";

describe("duplicateMessage", () => {
  it("says a name is taken only for name and key clashes", () => {
    expect(duplicateMessage(["projectId", "parentId", "name"])).toBe("That name is already taken.");
    expect(duplicateMessage(["groupId", "fullName"])).toBe("That name is already taken.");
    expect(duplicateMessage(["key"])).toBe("That name is already taken.");
    expect(duplicateMessage("Section_projectId_parentId_name_key")).toBe("That name is already taken.");
    expect(duplicateMessage(undefined)).toBe("That name is already taken.");
  });

  it("does not blame a name for a bug linked twice to a result", () => {
    expect(duplicateMessage(["defectId", "resultId"])).toBe("That was already saved. Reload the page and try again.");
    expect(duplicateMessage("DefectLink_pkey")).toBe("That was already saved. Reload the page and try again.");
    expect(duplicateMessage("RunEntry_runId_caseId_key")).toBe("That was already saved. Reload the page and try again.");
  });

  it("names an email clash", () => {
    expect(duplicateMessage(["email"])).toBe("That email is already in use.");
  });
});
