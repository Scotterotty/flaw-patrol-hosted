import { afterEach, describe, expect, it } from "vitest";
import { funOff, withFun } from "./fun";

const saved = process.env.FUN_FEATURES;
afterEach(() => {
  if (saved === undefined) delete process.env.FUN_FEATURES;
  else process.env.FUN_FEATURES = saved;
});

describe("FUN_FEATURES switch (backend review: fun features behind a flag)", () => {
  it("reads the setting", () => {
    for (const v of ["off", "OFF", "false", "0", "no", " off "]) expect(funOff(v)).toBe(true);
    for (const v of [undefined, "", "on", "true", "1"]) expect(funOff(v)).toBe(false);
  });

  it("treats everyone as not playing and not listening when off, without changing the saved person", () => {
    const person = { id: "u1", gameEnabled: true, radioEnabled: true, questMap: true };
    delete process.env.FUN_FEATURES;
    expect(withFun(person)).toBe(person);
    process.env.FUN_FEATURES = "off";
    expect(withFun(person)).toEqual({ id: "u1", gameEnabled: false, radioEnabled: false, questMap: false });
    expect(person.gameEnabled).toBe(true);
  });
});
