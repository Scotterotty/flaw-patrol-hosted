"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickArea, pickBox, type Box } from "./area-picker";
import { Button, cx } from "./ui";

/** Recordings stop by themselves at 5 minutes; the server takes videos up to 75 MB. */
export const MAX_RECORDING_SEC = 5 * 60;
export const MAX_VIDEO_BYTES = 75 * 1024 * 1024;

/**
 * Screen capture is the browser's own screen sharing box. It needs a computer
 * browser and a secure address (https, or localhost on the tester's own machine).
 */
export function useCaptureSupport(): { ok: boolean; why: string; /** Record an area works here. */ area: boolean } {
  const [state, setState] = useState({ ok: false, why: "", area: false });
  useEffect(() => {
    const api = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
    if (!window.isSecureContext) setState({ ok: false, why: "Screen capture needs Flaw Patrol opened at an https:// or localhost address.", area: false });
    else if (!api) setState({ ok: false, why: "This browser can't capture the screen. Use Chrome, Edge, Firefox or Safari on a computer.", area: false });
    else setState({ ok: true, why: "", area: canRecordArea() });
  }, []);
  return state;
}

const cancelled = (e: unknown) => e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");

/**
 * Record an area needs the browser to hand Flaw Patrol each video frame, so it can keep
 * just the box. Chrome and Edge can; Firefox and Safari can't yet.
 */
export function canRecordArea() {
  return typeof window !== "undefined" && "MediaStreamTrackProcessor" in window && "MediaStreamTrackGenerator" in window;
}
export const RECORD_AREA_LABEL = "Record an area (best for crashes)";
export const RECORD_AREA_TIP = "Records just the box you draw on your screen. If the app crashes, its crash window stays in the video.";
export const RECORD_AREA_NO = "Record an area works in Chrome or Edge.";

/** A still of the shared screen, at full size. */
async function stillOf(stream: MediaStream): Promise<HTMLCanvasElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // Give the first real frame a moment to arrive.
  await new Promise((r) => setTimeout(r, 250));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  video.srcObject = null;
  return canvas;
}

/** Last time's box, so the next Record an area starts with it drawn. Kept on this computer only. */
const AREA_KEY = "fp-record-area";
function lastBox(): Box | null {
  try {
    const b = JSON.parse(localStorage.getItem(AREA_KEY) ?? "null");
    return b && [b.x, b.y, b.w, b.h].every((n) => typeof n === "number") ? b : null;
  } catch {
    return null;
  }
}
function keepBox(b: Box) {
  try {
    localStorage.setItem(AREA_KEY, JSON.stringify(b));
  } catch {
    /* private window: the box just isn't remembered */
  }
}

/**
 * A video track of just the box. Each frame of the shared screen is cut down to the box.
 * It's driven by the frames themselves, not by timers, so it keeps up while Flaw Patrol's
 * tab is in the background. It ends when the screen sharing ends.
 */
function cropTrack(source: MediaStreamTrack, box: Box): MediaStreamTrack {
  // Video encoders want even sizes.
  const w = Math.max(2, Math.round(box.w / 2) * 2);
  const h = Math.max(2, Math.round(box.h / 2) * 2);
  const W = window as unknown as {
    MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
    MediaStreamTrackGenerator: new (o: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };
  };
  const out = new W.MediaStreamTrackGenerator({ kind: "video" });
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d")!;
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  void new W.MediaStreamTrackProcessor({ track: source }).readable
    .pipeThrough(
      new TransformStream<VideoFrame, VideoFrame>({
        transform(frame, next) {
          g.drawImage(frame, x, y, w, h, 0, 0, w, h);
          const cut = new VideoFrame(canvas, { timestamp: frame.timestamp });
          frame.close();
          next.enqueue(cut);
        },
      }),
    )
    .pipeTo(out.writable)
    .catch(() => {});
  return out;
}

/** One still image of the tab, window or screen the tester picks. Null when they cancel. */
/** One still image of the tab, window or screen the tester picks, or just the area they drag a box around. Null when they cancel. */
export async function takeScreenshot(fileName: string): Promise<File | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Give the first real frame a moment to arrive.
    await new Promise((r) => setTimeout(r, 250));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    // Stop sharing before the area picker opens, so the browser's sharing bar goes away.
    stream.getTracks().forEach((t) => t.stop());
    // Drag a box around just the part you want, or attach the whole picture.
    const picked = await pickArea(canvas);
    if (!picked) return null;
    const blob = await new Promise<Blob | null>((r) => picked.toBlob(r, "image/png"));
    if (!blob) throw new Error("Couldn't take the screenshot.");
    return new File([blob], fileName, { type: "image/png" });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function pickMime() {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

type Live = {
  recorder: MediaRecorder;
  display: MediaStream;
  audio: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  mic: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null;
  withSound: boolean;
  chunks: Blob[];
  keep: boolean;
  /** The cut-down track for Record an area, stopped with the rest. */
  area: MediaStreamTrack | null;
};

export type Recording = { stepIndex: number | null; label: string; baseName: string; /** Record an area: just a box of the screen. */ area?: boolean };
export type Finished = Recording & { file: File; seconds: number };

/**
 * Record the screen with the browser's MediaRecorder: pause, resume, mic on or
 * off while recording, stop and attach, or discard. Stops itself at 5 minutes
 * or when the tester ends sharing from the browser's own bar.
 */
export function useScreenRecorder(onFinished: (f: Finished) => void, onError: (message: string) => void) {
  const live = useRef<Live | null>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [paused, setPaused] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timing = useRef({ ms: 0, since: 0 });
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const seconds = () => (timing.current.ms + (timing.current.since ? Date.now() - timing.current.since : 0)) / 1000;

  const cleanUp = useCallback(() => {
    const l = live.current;
    if (!l) return;
    l.display.getTracks().forEach((t) => t.stop());
    l.area?.stop();
    l.mic?.stream.getTracks().forEach((t) => t.stop());
    void l.audio.close();
    live.current = null;
    timing.current = { ms: 0, since: 0 };
    setRec(null);
    setPaused(false);
    setMicOn(false);
    setElapsed(0);
  }, []);

  const stop = useCallback((keep: boolean) => {
    const l = live.current;
    if (!l) return;
    l.keep = keep;
    if (l.recorder.state !== "inactive") l.recorder.stop();
    else cleanUp();
  }, [cleanUp]);

  // Busy picking a window or drawing the box: a second press does nothing.
  const starting = useRef(false);
  const [picking, setPicking] = useState(false);
  const begin = useCallback(
    async (r: Recording) => {
      const mimeType = pickMime();
      if (!mimeType) return onError("This browser can't record video. Use Chrome, Edge, Firefox or Safari on a computer.");
      if (r.area && !canRecordArea()) return onError(RECORD_AREA_NO);
      let display: MediaStream;
      try {
        // For an area, the browser offers the whole screen first.
        display = await navigator.mediaDevices.getDisplayMedia({
          video: r.area ? ({ frameRate: 30, displaySurface: "monitor" } as MediaTrackConstraints) : { frameRate: 30 },
          audio: true,
        });
      } catch (e) {
        if (!cancelled(e)) onError("Couldn't start the screen recording.");
        return;
      }
      // Record an area: drag a box on a still of the screen; only the box is recorded.
      let area: MediaStreamTrack | null = null;
      if (r.area) {
        const quit = () => display.getTracks().forEach((t) => t.stop());
        let box: Box | "whole" | null = null;
        try {
          const still = await stillOf(display);
          box = await pickBox(
            still,
            { label: "Pick the area to record", hint: "Drag a box around the part to record. Only the box is saved.", take: "Record this area" },
            lastBox(),
          );
        } catch {
          quit();
          return onError("Couldn't start the screen recording.");
        }
        if (!box || box === "whole" || display.getVideoTracks()[0]?.readyState !== "live") return quit();
        keepBox(box);
        area = cropTrack(display.getVideoTracks()[0], box);
      }
      // Sound goes through one mixer, so the microphone can be switched on and off mid-recording.
      const audio = new AudioContext();
      const dest = audio.createMediaStreamDestination();
      if (display.getAudioTracks().length) audio.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
      // With no sound source (no tab sound, mic off) Chrome sends no audio and then writes
      // no video either, so a silent source keeps the sound track ticking.
      const silence = audio.createConstantSource();
      silence.offset.value = 0;
      silence.connect(dest);
      silence.start();
      // A mixer the browser keeps paused sends no sound, and Chrome then writes no video
      // either (an empty file). Wake it up, and record without sound if it won't run.
      await Promise.race([audio.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
      const withSound = audio.state === "running";
      const video = area ? [area] : display.getVideoTracks();
      const recorder = new MediaRecorder(new MediaStream([...video, ...(withSound ? dest.stream.getAudioTracks() : [])]), {
        mimeType,
        videoBitsPerSecond: 1_600_000,
        audioBitsPerSecond: 96_000,
      });
      const l: Live = { recorder, display, audio, dest, mic: null, withSound, chunks: [], keep: true, area };
      live.current = l;
      recorder.ondataavailable = (e) => e.data.size && l.chunks.push(e.data);
      recorder.onstop = () => {
        const secs = seconds();
        const type = mimeType.split(";")[0];
        const blob = new Blob(l.chunks, { type });
        cleanUp();
        if (!l.keep) return;
        if (!blob.size) return onError("The recording came out empty, so it wasn't attached. Try Record screen again.");
        if (blob.size > MAX_VIDEO_BYTES) return onError("That recording is over 75 MB, so it wasn't attached. Record a shorter clip or a smaller window.");
        const file = new File([blob], `${r.baseName}.${type === "video/mp4" ? "mp4" : "webm"}`, { type });
        finished.current({ ...r, file, seconds: Math.round(secs) });
      };
      // The browser's own "Stop sharing" button ends the recording and attaches it.
      display.getVideoTracks()[0]?.addEventListener("ended", () => stop(true));
      recorder.start(1000);
      timing.current = { ms: 0, since: Date.now() };
      setRec(r);
    },
    [cleanUp, onError, stop],
  );
  const start = useCallback(
    async (r: Recording) => {
      if (live.current || starting.current) return;
      starting.current = true;
      setPicking(true);
      try {
        await begin(r);
      } finally {
        starting.current = false;
        setPicking(false);
      }
    },
    [begin],
  );

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const s = seconds();
      setElapsed(s);
      if (s >= MAX_RECORDING_SEC) stop(true);
    }, 250);
    return () => clearInterval(t);
  }, [rec, stop]);

  // Leaving the case mid-recording throws the recording away.
  useEffect(() => () => stop(false), [stop]);

  const togglePause = () => {
    const l = live.current;
    if (!l) return;
    if (l.recorder.state === "recording") {
      l.recorder.pause();
      timing.current = { ms: timing.current.ms + Date.now() - timing.current.since, since: 0 };
      setPaused(true);
    } else if (l.recorder.state === "paused") {
      l.recorder.resume();
      timing.current = { ...timing.current, since: Date.now() };
      setPaused(false);
    }
  };

  const toggleMic = async () => {
    const l = live.current;
    if (!l) return;
    if (!l.withSound) return onError("This recording has no sound: the browser didn't let Flaw Patrol use audio. Stop it and record again to add your microphone.");
    if (l.mic) {
      l.mic.node.disconnect();
      l.mic.stream.getTracks().forEach((t) => t.stop());
      l.mic = null;
      setMicOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (live.current !== l) return stream.getTracks().forEach((t) => t.stop());
      const node = l.audio.createMediaStreamSource(stream);
      node.connect(l.dest);
      l.mic = { stream, node };
      setMicOn(true);
    } catch {
      onError("Couldn't use the microphone. Check the browser's microphone permission for this site.");
    }
  };

  return { rec, picking, paused, micOn, elapsed, start, stop, togglePause, toggleMic };
}

/**
 * The bar while recording. On a page it floats at the bottom of the screen, above the phone
 * menu bar, with room left under the page so it never covers a button. Inside a popup box
 * (`inline`) it sticks to the top of the box, so it stays in sight however long the box is.
 */
export function RecordingBar({ r, inline }: { r: ReturnType<typeof useScreenRecorder>; inline?: boolean }) {
  if (!r.rec) return null;
  const bar = (
    <div
      role="region"
      aria-label="Screen recording"
      className={cx(
        "flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-surface px-3 py-2 text-sm shadow-lg",
        inline ? "sticky top-0 z-10 mb-4 w-full" : "fixed inset-x-0 bottom-16 z-40 mx-auto w-fit max-w-[calc(100%-2rem)] md:bottom-4",
      )}
    >
      <span className={cx("size-2.5 rounded-full", r.paused ? "bg-slate-400" : "animate-pulse bg-red-600")} aria-hidden />
      <span className="font-medium text-slate-800">Recording {r.rec.label}</span>
      <span className="font-mono text-xs text-slate-500" aria-live="off">
        {clock(r.elapsed)} / {clock(MAX_RECORDING_SEC)}
      </span>
      <Button size="sm" onClick={() => void r.toggleMic()} aria-pressed={r.micOn} title={r.micOn ? "Stop recording your microphone" : "Add your microphone to the recording"}>
        {r.micOn ? "🎙 Mic on" : "Mic off"}
      </Button>
      <Button size="sm" onClick={r.togglePause}>
        {r.paused ? "Resume" : "Pause"}
      </Button>
      <Button size="sm" variant="primary" onClick={() => r.stop(true)}>
        Stop and attach
      </Button>
      <Button size="sm" variant="ghost" onClick={() => r.stop(false)}>
        Discard
      </Button>
    </div>
  );
  if (inline) return bar;
  return (
    <>
      {/* Room under the page, so the last buttons can scroll up clear of the bar. */}
      <div aria-hidden className="h-20" data-testid="recording-room" />
      {bar}
    </>
  );
}

/** Shown once after a recording is attached, before it settles in as a 🎥 chip. */
export function RecordingPreview({
  id,
  fileName,
  seconds,
  size,
  label,
  onRerecord,
  onRemove,
  onClose,
}: {
  id: string;
  fileName: string;
  seconds: number;
  size: number;
  label: string;
  onRerecord: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Recording attached"
      className="fixed inset-x-0 bottom-16 z-40 mx-auto w-[min(26rem,calc(100%-2rem))] md:bottom-4 rounded-xl border border-slate-200 bg-surface p-3 text-sm shadow-lg"
    >
      <video src={`/api/attachments/${id}`} controls className="aspect-video w-full rounded-md bg-black" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-800">{fileName}</span>
          <span className="block text-xs text-slate-500">
            {clock(seconds)} · {(size / 1024 / 1024).toFixed(1)} MB · attached to {label}
          </span>
        </span>
        <Button size="sm" onClick={onRerecord}>
          Re-record
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
        <Button size="sm" variant="ghost" aria-label="Close preview" onClick={onClose}>
          ✕
        </Button>
      </div>
    </div>
  );
}
