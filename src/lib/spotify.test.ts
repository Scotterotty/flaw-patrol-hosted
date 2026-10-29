import { describe, expect, it } from "vitest";
import { parseSpotifyLinks, parseSpotifyUrl, spotifyEmbed } from "./spotify";

describe("parseSpotifyUrl", () => {
  it("reads share links, language links and URIs", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXc8kgYqQLMfH?si=abc123")).toBe("playlist:37i9dQZF1DXc8kgYqQLMfH");
    expect(parseSpotifyUrl(" https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy ")).toBe("album:4aawyAB9vmqN3uQ7FjRGTy");
    expect(parseSpotifyUrl("spotify:show:4rOoJ6Egrf8K2IrywzwOMk")).toBe("show:4rOoJ6Egrf8K2IrywzwOMk");
  });
  it("rejects other sites and pages", () => {
    expect(parseSpotifyUrl("https://evil.example/playlist/37i9dQZF1DXc8kgYqQLMfH")).toBeNull();
    expect(parseSpotifyUrl("https://open.spotify.com/user/someone")).toBeNull();
    expect(parseSpotifyUrl("not a link")).toBeNull();
  });
  it("builds the embed address", () => {
    expect(spotifyEmbed("playlist:37i9dQZF1DXc8kgYqQLMfH")).toBe("https://open.spotify.com/embed/playlist/37i9dQZF1DXc8kgYqQLMfH?utm_source=generator");
  });
  it("drops saved links it doesn't understand", () => {
    expect(parseSpotifyLinks([{ id: "playlist:abc", name: "Focus" }, { id: "bad", name: "x" }, "junk"])).toEqual([]);
    expect(parseSpotifyLinks([{ id: "playlist:abc", name: "Focus" }, { id: "bad", name: "x" }])).toEqual([]);
    expect(parseSpotifyLinks([{ id: "album:Abc123", name: "Kind of Blue" }])).toEqual([{ id: "album:Abc123", name: "Kind of Blue" }]);
  });
});
