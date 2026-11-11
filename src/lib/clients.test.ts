import { describe, expect, it } from "vitest";
import { cleanClients, clientResults, clientsForCase, entryClientResults, guessClients, listClients, withClients } from "./clients";
import { expandForRun, stepsToRun } from "./steps";

const DDR = ["Web", "Unreal", "Unity iOS", "Web (remote user)"];

describe("clients", () => {
  it("tidies the list", () => {
    expect(cleanClients([" Web ", "web", "", "Unreal", "Unity  iOS"])).toEqual(["Web", "Unreal", "Unity iOS"]);
    expect(cleanClients(Array.from({ length: 12 }, (_, i) => `C${i}`))).toHaveLength(8);
  });

  it("guesses a case's clients from its words", () => {
    expect(guessClients("Web - Move, scale and rotate an asset. Ensure translation across all other clients.", DDR)).toEqual(DDR);
    expect(guessClients("Custom avatar upload\nUser is able to upload and select a custom avatar on the Web.", DDR)).toEqual(["Web"]);
    expect(guessClients("Unity iOS - Ensure that the user is able to view the space in AR.", DDR)).toEqual(["Unity iOS"]);
    expect(guessClients("On Unreal, create a new project, then import the plugin.", DDR)).toEqual(["Unreal"]);
    expect(guessClients("Validate Gaussian Splat model of Queen Mary is visible on Web and Web Remote.", DDR)).toEqual(["Web", "Web (remote user)"]);
    expect(guessClients("Mag Office site model is visible on Web & Unreal.", DDR)).toEqual(["Web", "Unreal"]);
    expect(guessClients("Users appear as their selected generic avatar across all platforms.", DDR)).toEqual(DDR);
    expect(guessClients("Soak test for 30 minutes.", DDR)).toEqual(DDR);
    expect(guessClients("UEEE: eCommerce\nProduct ID shows", DDR)).toEqual(["Unreal"]);
    expect(guessClients("Login works on:\n- Web\n- Unreal\n- Unity iOS\n- Web (Remote user)", DDR)).toEqual(DDR);
  });

  it("uses the clients picked on the case when the cycle has them", () => {
    expect(clientsForCase(["unreal"], DDR, "Web - anything")).toEqual(["Unreal"]);
    expect(clientsForCase(["Android"], DDR, "Web - anything")).toEqual(["Web"]);
    expect(clientsForCase(["Web"], [], "Web")).toEqual([]);
  });

  it("runs a case once per client, and a title-only case shows its title", () => {
    const data = withClients(null, ["Web", "Unreal"]);
    expect(data).toEqual({ columns: ["client"], rows: [["Web"], ["Unreal"]] });
    const steps = expandForRun([{ kind: "step", action: "", expected: "Avatar shows on {{client}}" }], new Map(), data);
    expect(steps.map((s) => [s.row, s.expected])).toEqual([
      [0, "Avatar shows on Web"],
      [1, "Avatar shows on Unreal"],
    ]);
    expect(stepsToRun(steps, "Avatar").map((s) => s.action)).toEqual(["Avatar", "Avatar"]);
    expect(withClients({ columns: ["browser"], rows: [["Safari"], ["Chrome"]] }, ["Web"]).rows).toEqual([
      ["Web", "Safari"],
      ["Web", "Chrome"],
    ]);
  });

  it("gives each client the worst of its steps", () => {
    const data = withClients(null, ["Web", "Unreal", "Unity iOS"]);
    const rowOf = [0, 0, 1, 1, 2, 2];
    expect(clientResults(["Web", "Unreal", "Unity iOS"], data, rowOf, ["PASSED", "PASSED", "PASSED", "FAILED", "UNTESTED", "UNTESTED"])).toEqual({ Web: "PASSED", Unreal: "FAILED", "Unity iOS": "UNTESTED" });
    expect(clientResults(["Web"], data, rowOf, ["PASSED", "UNTESTED", "PASSED", "PASSED", "PASSED", "PASSED"])).toEqual({ Web: "IN_PROGRESS" });
    expect(entryClientResults({ clients: ["Web", "Unreal"], rowClient: ["Web", "Unreal"], rowOf: [0, 1] }, null)).toEqual({ Web: "UNTESTED", Unreal: "UNTESTED" });
  });

  it("lists clients in words", () => {
    expect(listClients(["Web"])).toBe("Web");
    expect(listClients(["Web", "Unreal", "Unity iOS"])).toBe("Web, Unreal and Unity iOS");
  });
});
