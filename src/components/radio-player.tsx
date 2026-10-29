"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { RADIO_STATIONS, stationFor, stationPage } from "@/lib/radio";
import { isSpotifyStation, KIND_LABEL, SPOTIFY_PREFIX, spotifyEmbed, spotifyKind, spotifyPage, type SpotifyLink } from "@/lib/spotify";
import { updateMyRadio } from "@/server/account";
import { cx } from "./ui";

// The radio lives in the root layout, so it keeps playing while you move
// between pages and projects; only the small control in the top bar is
// redrawn with each page. Stations don't allow their streams to be played
// inside other websites, so they open their own page in a small window, which
// can be stopped but not paused. Saved Spotify links play in Spotify's own
// player, which its iFrame API lets us play and pause from the top bar.

type SpotifyController = {
  togglePlay: () => void;
  play: () => void;
  destroy: () => void;
  addListener: (event: "playback_update" | "ready", cb: (e: { data: { isPaused: boolean } }) => void) => void;
};
type SpotifyIFrameAPI = {
  createController: (el: HTMLElement, options: { uri: string; width: string; height: number }, cb: (c: SpotifyController) => void) => void;
};

let spotifyApi: Promise<SpotifyIFrameAPI> | null = null;
function loadSpotifyApi() {
  spotifyApi ??= new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    (window as unknown as { onSpotifyIframeApiReady: (api: SpotifyIFrameAPI) => void }).onSpotifyIframeApiReady = resolve;
    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    script.onerror = () => reject(new Error("Spotify's player didn't load"));
    document.body.appendChild(script);
    setTimeout(() => reject(new Error("Spotify's player took too long")), 8000);
  });
  return spotifyApi;
}

type Radio = {
  station: string;
  spotify: SpotifyLink[];
  changeStation: (id: string) => void;
  /** What the round button does now. */
  mode: "play" | "pause" | "stop";
  press: () => void;
  playing: boolean;
  paused: boolean;
  playerOn: boolean;
  playerShown: boolean;
  setPlayerShown: (shown: boolean) => void;
};
const RadioContext = createContext<Radio | null>(null);

export function RadioProvider({ initialStation, spotify, children }: { initialStation: string; spotify: SpotifyLink[]; children: React.ReactNode }) {
  const [station, setStation] = useState(initialStation);
  // The Spotify player stays loaded while hidden, so the music keeps going.
  const [playerOn, setPlayerOn] = useState(false);
  const [playerShown, setPlayerShown] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [apiFailed, setApiFailed] = useState(false);
  const [controller, setController] = useState<SpotifyController | null>(null);
  const [stationWindow, setStationWindow] = useState<Window | null>(null);
  const wantPlay = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const spotifyId = isSpotifyStation(station) ? station.slice(SPOTIFY_PREFIX.length) : null;
  const link = spotify.find((l) => l.id === spotifyId);

  // Follow changes made in Settings (such as adding a Spotify link) without reloading.
  const lastProp = useRef(initialStation);
  useEffect(() => {
    if (lastProp.current === initialStation) return;
    lastProp.current = initialStation;
    setStation(initialStation);
    setPlayerOn(isSpotifyStation(initialStation));
    setPlayerShown(isSpotifyStation(initialStation));
  }, [initialStation]);

  // Load Spotify's player into the panel; it's replaced when the link changes.
  useEffect(() => {
    if (!spotifyId || !playerOn || apiFailed) return;
    const box = host.current;
    if (!box) return;
    let gone = false;
    let made: SpotifyController | null = null;
    loadSpotifyApi()
      .then((api) => {
        if (gone) return;
        // Spotify swaps this element for its iframe, so it isn't one React draws.
        const el = document.createElement("div");
        box.replaceChildren(el);
        api.createController(el, { uri: `spotify:${spotifyId}`, width: "100%", height: 352 }, (c) => {
          if (gone) return c.destroy();
          made = c;
          setController(c);
          c.addListener("playback_update", (e) => {
            setPlaying(!e.data.isPaused);
            if (!e.data.isPaused) setPlayed(true);
          });
          c.addListener("ready", () => {
            if (wantPlay.current) c.play();
            wantPlay.current = false;
          });
        });
      })
      .catch(() => !gone && setApiFailed(true));
    return () => {
      gone = true;
      made?.destroy();
      box.replaceChildren();
      setController(null);
      setPlaying(false);
      setPlayed(false);
    };
  }, [spotifyId, playerOn, apiFailed]);

  // A station's window can be closed from its own title bar; the button follows.
  useEffect(() => {
    if (!stationWindow) return;
    const timer = setInterval(() => stationWindow.closed && setStationWindow(null), 1000);
    return () => clearInterval(timer);
  }, [stationWindow]);

  const openStation = useCallback((id: string) => {
    // Reusing the window name keeps it to one radio window.
    const w = window.open(stationPage(id), "flaw-patrol-radio", "popup,width=460,height=720");
    setStationWindow(w);
  }, []);

  const changeStation = (id: string) => {
    setStation(id);
    if (isSpotifyStation(id)) {
      stationWindow?.close();
      setStationWindow(null);
      setPlayerOn(true);
      setPlayerShown(true);
    } else {
      setPlayerOn(false);
      // A station already playing switches over in its window.
      if (stationWindow && !stationWindow.closed) openStation(id);
    }
    void updateMyRadio({ enabled: true, station: id });
  };

  const mode: Radio["mode"] = spotifyId ? (playing ? "pause" : "play") : stationWindow ? "stop" : "play";
  const press = () => {
    if (!spotifyId) {
      if (stationWindow) {
        stationWindow.close();
        setStationWindow(null);
      } else openStation(station);
      return;
    }
    if (!playerOn) {
      wantPlay.current = true;
      setPlayerOn(true);
      setPlayerShown(true);
    } else if (controller) controller.togglePlay();
    // Without Spotify's API the button can only bring the player back.
    else setPlayerShown(true);
  };

  const radio: Radio = {
    station,
    spotify,
    changeStation,
    mode,
    press,
    playing: spotifyId ? playing : !!stationWindow,
    paused: !!spotifyId && played && !playing,
    playerOn: !!spotifyId && playerOn,
    playerShown,
    setPlayerShown,
  };

  return (
    <RadioContext.Provider value={radio}>
      {children}
      {spotifyId && playerOn && (
        <div
          role="group"
          aria-label="Spotify player"
          className={cx(
            "fixed top-13 right-4 z-30 w-80 overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-xl print:hidden",
            !playerShown && "hidden",
          )}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <a href={spotifyPage(spotifyId)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-slate-700 hover:underline">
              Open in Spotify
            </a>
            <button type="button" onClick={() => setPlayerShown(false)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100" title="Keeps playing">
              Hide
            </button>
            <button type="button" onClick={() => setPlayerOn(false)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">
              Stop
            </button>
          </div>
          {apiFailed ? (
            <iframe
              key={spotifyId}
              title={`Spotify: ${link?.name ?? "player"}`}
              src={spotifyEmbed(spotifyId)}
              width="100%"
              height="352"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="block border-0"
            />
          ) : (
            <div ref={host} className="h-[352px] [&>iframe]:block [&>iframe]:border-0" />
          )}
        </div>
      )}
    </RadioContext.Provider>
  );
}

const ICON = {
  play: <path d="M4 2.8v10.4a.8.8 0 0 0 1.2.7l8.6-5.2a.8.8 0 0 0 0-1.4L5.2 2.1A.8.8 0 0 0 4 2.8Z" />,
  pause: <path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" />,
  stop: <rect x="3.5" y="3.5" width="9" height="9" rx="1.2" />,
};
const LABEL = { play: "Play", pause: "Pause", stop: "Stop" };

/** Small moving bars that show something is playing. */
function PlayingBars() {
  return (
    <span className="inline-flex h-2.5 items-end gap-px" aria-hidden>
      {[0, 1, 2].map((i) => (
        <i key={i} className="radio-bar block w-0.5 rounded-sm bg-accent-600" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
    </span>
  );
}

/** The radio control docked in the top bar, shown only to people who turned the radio on. */
export function RadioPlayer() {
  const radio = useContext(RadioContext);
  if (!radio) return null;
  const { station, spotify, changeStation, mode, press, playing, paused, playerOn, playerShown, setPlayerShown } = radio;
  const spotifyId = isSpotifyStation(station) ? station.slice(SPOTIFY_PREFIX.length) : null;
  const info = stationFor(station);
  const line = spotifyId
    ? playing
      ? "Playing · Spotify"
      : paused
        ? "Paused · Spotify"
        : `${KIND_LABEL[spotifyKind(spotifyId) ?? "playlist"]} · Spotify`
    : playing
      ? `Playing · ${info.source}`
      : `${info.note} · ${info.source}`;

  return (
    <div
      role="region"
      aria-label="Radio"
      className="relative flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-surface py-0.5 pr-2 pl-0.5 text-xs text-slate-600 print:hidden"
    >
      <button
        type="button"
        onClick={press}
        aria-label={LABEL[mode]}
        title={mode === "stop" ? "Closes the station's window" : spotifyId ? undefined : "Opens the station in a small window"}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white hover:bg-accent-700"
      >
        <svg viewBox="0 0 16 16" className={cx("size-3.5", mode === "play" && "ml-0.5")} fill="currentColor" aria-hidden>
          {ICON[mode]}
        </svg>
      </button>
      <div className="flex min-w-0 flex-col leading-tight">
        <div className="flex items-center">
          <select
            aria-label="Station"
            value={station}
            onChange={(e) => changeStation(e.target.value)}
            className="-ml-1 max-w-28 cursor-pointer truncate rounded bg-transparent px-1 font-medium text-slate-800 hover:bg-slate-100 sm:max-w-40"
          >
            <optgroup label="Radio stations">
              {RADIO_STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            {spotify.length > 0 && (
              <optgroup label="Your Spotify">
                {spotify.map((l) => (
                  <option key={l.id} value={SPOTIFY_PREFIX + l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {playerOn && (
            <button
              type="button"
              onClick={() => setPlayerShown(!playerShown)}
              aria-label={playerShown ? "Hide Spotify player" : "Show Spotify player"}
              aria-expanded={playerShown}
              className="rounded px-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d={playerShown ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
              </svg>
            </button>
          )}
        </div>
        <span className="hidden items-center gap-1.5 text-[11px] text-slate-500 lg:flex">
          {line}
          {playing && <PlayingBars />}
        </span>
      </div>
    </div>
  );
}
