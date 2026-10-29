"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx } from "./ui";

/** Recordings stop by themselves at 5 minutes; the server takes videos up to 75 MB. */
export const MAX_RECORDING_SEC = 5 * 60;
export const MAX_VIDEO_BYTES = 75 * 1024 * 1024;

/**
 * Screen capture is the browser's own screen sharing box. It needs a computer
 * browser and a secure address (https, or localhost on the tester's own machine).
 */
export function useCaptureSupport(): { ok: boolean; why: string } {
  const [state, setState] = useState({ ok: false, why: "" });
  useEffect(() => {
    const api = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
    if (!window.isSecureContext) setState({ ok: false, why: "Screen capture needs Flaw Patrol opened at an https:// or localhost address." });
    else if (!api) setState({ ok: false, why: "This browser can't capture the screen. Use Chrome, Edge, Firefox or Safari on a computer." });
    else setState({ ok: true, why: "" });
  }, []);
  return state;
}

const cancelled = (e: unknown) => e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");

/** One still image of the tab, window or screen the tester picks. Null when they cancel. */
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
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
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
};

export type Recording = { stepIndex: number | null; label: string; baseName: string };
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

  const start = useCallback(
    async (r: Recording) => {
      if (live.current) return;
      const mimeType = pickMime();
      if (!mimeType) return onError("This browser can't record video. Use Chrome, Edge, Firefox or Safari on a computer.");
      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      } catch (e) {
        if (!cancelled(e)) onError("Couldn't start the screen recording.");
        return;
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
      const recorder = new MediaRecorder(new MediaStream([...display.getVideoTracks(), ...(withSound ? dest.stream.getAudioTracks() : [])]), {
        mimeType,
        videoBitsPerSecond: 1_600_000,
        audioBitsPerSecond: 96_000,
      });
      const l: Live = { recorder, display, audio, dest, mic: null, withSound, chunks: [], keep: true };
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

  return { rec, paused, micOn, elapsed, start, stop, togglePause, toggleMic };
}

/** The pinned bar while recording, or a box in place inside a dialog (`inline`). */
export function RecordingBar({ r, inline }: { r: ReturnType<typeof useScreenRecorder>; inline?: boolean }) {
  if (!r.rec) return null;
  return (
    <div
      role="region"
      aria-label="Screen recording"
      className={cx(
        "flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-surface px-3 py-2 text-sm",
        inline ? "w-full" : "fixed inset-x-0 bottom-4 z-40 mx-auto w-fit max-w-[calc(100%-2rem)] shadow-lg",
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
      className="fixed inset-x-0 bottom-4 z-40 mx-auto w-[min(26rem,calc(100%-2rem))] rounded-xl border border-slate-200 bg-surface p-3 text-sm shadow-lg"
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
