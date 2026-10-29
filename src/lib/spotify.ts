import { z } from "zod";
import { isRadioStation } from "./radio";

// Spotify lets its player be embedded in other sites (unlike the radio
// stations), so saved links play inside the radio. Signed-in Premium listeners
// hear whole tracks; everyone else gets Spotify's 30-second previews.

export const SPOTIFY_KINDS = ["playlist", "album", "artist", "track", "show", "episode"] as const;
export type SpotifyKind = (typeof SPOTIFY_KINDS)[number];

export const KIND_LABEL: Record<SpotifyKind, string> = {
  playlist: "Playlist",
  album: "Album",
  artist: "Artist",
  track: "Song",
  show: "Podcast",
  episode: "Podcast episode",
};

export const MAX_SPOTIFY_LINKS = 12;

const linkSchema = z.object({ id: z.string().regex(/^[a-z]+:[A-Za-z0-9]+$/), name: z.string().max(200) });
export type SpotifyLink = z.infer<typeof linkSchema>;

export function parseSpotifyLinks(json: unknown): SpotifyLink[] {
  const parsed = z.array(linkSchema).safeParse(json);
  return parsed.success ? parsed.data.filter((l) => spotifyKind(l.id)) : [];
}

/**
 * "kind:id" from a share link (open.spotify.com/playlist/…?si=…, with or
 * without a language part like /intl-de/) or a Spotify URI (spotify:album:…).
 */
export function parseSpotifyUrl(raw: string): string | null {
  const text = raw.trim();
  const uri = text.match(/^spotify:([a-z]+):([A-Za-z0-9]{10,40})$/);
  if (uri) return (SPOTIFY_KINDS as readonly string[]).includes(uri[1]) ? `${uri[1]}:${uri[2]}` : null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.hostname !== "open.spotify.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  if (parts[0] === "embed") parts.shift();
  const [kind, id] = parts;
  return (SPOTIFY_KINDS as readonly string[]).includes(kind) && /^[A-Za-z0-9]{10,40}$/.test(id ?? "") ? `${kind}:${id}` : null;
}

export const spotifyKind = (id: string): SpotifyKind | null => {
  const kind = id.split(":")[0];
  return (SPOTIFY_KINDS as readonly string[]).includes(kind) ? (kind as SpotifyKind) : null;
};

export const spotifyPage = (id: string) => `https://open.spotify.com/${id.replace(":", "/")}`;
export const spotifyEmbed = (id: string) => `https://open.spotify.com/embed/${id.replace(":", "/")}?utm_source=generator`;

/** The radio station value for a saved link. */
export const SPOTIFY_PREFIX = "spotify:";
export const isSpotifyStation = (station: string) => station.startsWith(SPOTIFY_PREFIX);

/** The saved station if it still exists, otherwise the first station. */
export function validStation(station: string, links: SpotifyLink[]): string {
  return isRadioStation(station) || links.some((l) => SPOTIFY_PREFIX + l.id === station) ? station : "fluid";
}
