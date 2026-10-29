"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, MAX_SPOTIFY_LINKS, SPOTIFY_PREFIX, spotifyKind, spotifyPage, type SpotifyLink } from "@/lib/spotify";
import { addSpotifyLink, removeSpotifyLink, updateMyRadio } from "@/server/account";
import { Button, ErrorText, Input } from "./ui";

/** Off by default. Turning it on shows the player in the corner of every page. */
export function RadioSettings({ enabled, station, spotify }: { enabled: boolean; station: string; spotify: SpotifyLink[] }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [links, setLinks] = useState(spotify);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    setOn(next);
    start(async () => {
      const res = await updateMyRadio({ enabled: next, station });
      setError(res.ok ? null : res.error);
      router.refresh();
    });
  };

  const add = () =>
    start(async () => {
      const res = await addSpotifyLink(url);
      if (!res.ok) return setError(res.error);
      setError(null);
      setUrl("");
      setLinks(res.links);
      setOn(true);
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      const res = await removeSpotifyLink(id);
      if (!res.ok) return setError(res.error);
      setLinks(res.links);
      router.refresh();
    });

  return (
    <div className="space-y-2 text-sm">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} className="mt-1 size-4 accent-accent-600" />
        <span>
          <span className="block text-slate-800">Show the radio player</span>
          <span className="block text-xs text-slate-500">
            Free stations: lo-fi hip hop and chill-out from{" "}
            <a href="https://somafm.com" target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
              SomaFM
            </a>{" "}
            (no ads), plus KUSC classical and KJAZZ 88.1 (public radio with short sponsor credits), and Pandora for your own stations (US only). A button in the bottom corner opens the station
            in a small window that keeps playing while you work. Drag it by its grip if it&apos;s in the way.
          </span>
        </span>
      </label>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <h3 className="font-semibold text-slate-900">Your Spotify</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Add your playlists, albums or podcasts and pick them in the radio. They play in Spotify&apos;s own player. If you&apos;re signed in to Spotify
          Premium in this browser you hear whole songs; otherwise Spotify only plays 30-second previews. Private playlists need making public first.
        </p>
        {links.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <a href={spotifyPage(l.id)} target="_blank" rel="noreferrer" className="block truncate font-medium text-slate-800 hover:underline">
                    {l.name}
                  </a>
                  <span className="text-xs text-slate-500">
                    {KIND_LABEL[spotifyKind(l.id) ?? "playlist"]}
                    {station === SPOTIFY_PREFIX + l.id && " · playing in the radio"}
                  </span>
                </div>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(l.id)} aria-label={`Remove ${l.name}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {links.length < MAX_SPOTIFY_LINKS && (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) add();
            }}
          >
            <Input
              aria-label="Spotify link"
              placeholder="https://open.spotify.com/playlist/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={pending || !url.trim()}>
              Add to radio
            </Button>
          </form>
        )}
        <p className="mt-1 text-xs text-slate-500">In Spotify, choose Share and then Copy link, and paste it here.</p>
      </div>
    </div>
  );
}
