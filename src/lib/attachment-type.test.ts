import { describe, expect, it } from "vitest";
import { attachmentType, isLogName, looksLikeText, MAX_LOG, NOT_ALLOWED } from "./attachment-type";

const text = new TextEncoder().encode("LogInit: Display: Running engine\n");
const binary = new Uint8Array([0x4d, 0x44, 0x4d, 0x50, 0, 0, 1, 2]);

describe("log and crash file uploads", () => {
  it("takes a .log whatever type the browser reports", () => {
    for (const t of ["", "text/plain", "text/x-log", "application/octet-stream", "application/x-log"]) {
      expect(attachmentType("UnrealGame.log", t, 100, text)).toEqual({ type: "text/plain" });
    }
  });

  it("knows rotated logs and Mac crash reports by name", () => {
    for (const n of ["output.log.1", "Game.log.bak", "Player-prev.log", "DxDiag.txt", "MyGame-2026.crash", "MyGame.ips"]) expect(isLogName(n)).toBe(true);
    for (const n of ["log.exe", "catalog", "notes.docx"]) expect(isLogName(n)).toBe(false);
  });

  it("refuses a binary file named .log", () => {
    expect(attachmentType("evil.log", "application/octet-stream", 100, binary).error).toBe(`evil.log isn't a text log. ${NOT_ALLOWED}`);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toBe(true);
  });

  it("takes crash dumps as downloads", () => {
    expect(attachmentType("UEMinidump.dmp", "", 100, binary)).toEqual({ type: "application/octet-stream" });
  });

  it("lets logs and dumps reach 24 MB, other files 10 MB", () => {
    expect(attachmentType("big.log", "", MAX_LOG, text)).toEqual({ type: "text/plain" });
    expect(attachmentType("big.log", "", MAX_LOG + 1, text).error).toBe("big.log is over 24 MB. Zip it and attach the zip, or attach the end of the log.");
    expect(attachmentType("shot.png", "image/png", 11 * 1024 * 1024, binary).error).toBe("Files can be up to 10 MB.");
    expect(attachmentType("clip.webm", "video/webm", 70 * 1024 * 1024, binary)).toEqual({ type: "video/webm" });
  });

  it("still refuses other files, and names them", () => {
    expect(attachmentType("game.exe", "application/octet-stream", 100, binary).error).toBe(`game.exe can't be attached. ${NOT_ALLOWED}`);
    expect(attachmentType("page.html", "text/html", 100, text).error).toBe(`page.html can't be attached. ${NOT_ALLOWED}`);
    expect(attachmentType("shot.png", "image/png", 100, binary)).toEqual({ type: "image/png" });
  });
});
