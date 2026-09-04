"use client";

import type { RefObject } from "react";
import AmbientNudge from "@/components/practice/AmbientNudge";
import type { LiveRead, SignalStatus } from "@/lib/signals-math";

/**
 * The call. The user's own camera is the hero and stays on screen the whole
 * time they're in the room, mirrored, because an unmirrored self-view is
 * disconcerting: you reach left and the person in front of you reaches right.
 *
 * The pills over it are the only live feedback anywhere in a roleplay, and they
 * are feedback in the weakest sense: two words and a coloured dot showing the
 * user their own signals. No score, no sentence, no voice, no advice, and
 * nothing that names a feeling. The coaching happens in the debrief, after.
 *
 * Every frame behind this stays on the device. The stream is local, MediaPipe
 * runs on WASM from our own origin, and nothing is recorded or uploaded.
 */

const PILL_LABEL = {
  eyeContact: "Eye contact",
  posture: "Open posture",
  steady: "Steady",
} as const;

const PILL_ORDER = ["eyeContact", "posture", "steady"] as const;

function Pill({ label, status }: { label: string; status: SignalStatus }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-card/92 px-2.5 py-1 text-xs font-medium text-ink shadow-sm backdrop-blur-sm"
      // Screen readers get the state in words; the dot alone would be colour-only.
      aria-label={`${label}: ${status === "good" ? "steady" : "worth a look"}`}
    >
      <span
        aria-hidden
        className={[
          "h-1.5 w-1.5 rounded-full transition-colors duration-500",
          status === "good" ? "bg-blue" : "bg-amber",
        ].join(" ")}
      />
      {label}
    </span>
  );
}

function CameraIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.8}>
      <rect x="2.5" y="6" width="13" height="12" rx="3" stroke="currentColor" />
      <path d="M15.5 11l6-3.5v9l-6-3.5z" stroke="currentColor" strokeLinejoin="round" />
      {!on && <path d="M3 3l18 18" stroke="currentColor" strokeLinecap="round" />}
    </svg>
  );
}

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.8}>
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeLinecap="round" />
      {!on && <path d="M3 3l18 18" stroke="currentColor" strokeLinecap="round" />}
    </svg>
  );
}

function EndIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.8}>
      <path
        d="M3.5 14.5c4.7-4.7 12.3-4.7 17 0l-2.4 2.4-3.3-1.6v-2.6a10.6 10.6 0 0 0-5.6 0v2.6l-3.3 1.6-2.4-2.4z"
        stroke="currentColor"
        strokeLinejoin="round"
        fill="currentColor"
      />
    </svg>
  );
}

function ControlButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  /** True is the "on"/normal state; false renders as muted-off. */
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={[
        "flex h-11 w-11 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition-colors",
        active ? "bg-card/92 text-ink hover:bg-card" : "bg-ink/70 text-page hover:bg-ink/80",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function CallStage({
  videoRef,
  live,
  read,
  nudgeLevel,
  cameraOn,
  micOn,
  onToggleCamera,
  onToggleMic,
  onEnd,
  endLabel,
  endDisabled,
  presence,
  message,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True once frames are actually arriving. Everything else is a placeholder. */
  live: boolean;
  /** Null while the read is resting, which is any time outside a roleplay. */
  read: LiveRead | null;
  nudgeLevel: number | null;
  cameraOn: boolean;
  micOn: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onEnd: () => void;
  endLabel: string;
  /** Nothing to end: no rehearsal running and the camera already off. */
  endDisabled: boolean;
  /** What the chip in the top-left says the coach is doing. */
  presence: string;
  /** Why there's no picture, when there isn't one. */
  message?: string;
}) {
  return (
    <div className="relative h-[42vh] w-full shrink-0 overflow-hidden rounded-2xl border bg-fill hairline md:h-auto md:min-h-0 md:flex-1">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden
        className={[
          "h-full w-full -scale-x-100 object-cover transition-opacity duration-500",
          live ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <span aria-hidden className="h-2 w-2 rounded-full bg-ink-3" />
          <p className="max-w-sm text-sm leading-relaxed text-ink-2">
            {message ?? "Camera off. Everything else works exactly the same."}
          </p>
        </div>
      )}

      {/* Presence, top-left. */}
      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-card/92 px-2.5 py-1 text-xs font-medium text-ink shadow-sm backdrop-blur-sm">
        <span className="relative flex h-1.5 w-1.5">
          <span aria-hidden className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue/70" />
          <span aria-hidden className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
        </span>
        {presence}
      </div>

      {/* The live read, top-right. Absent entirely while it's resting. */}
      {live && read && (
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1.5">
          {PILL_ORDER.map((key) => (
            <Pill key={key} label={PILL_LABEL[key]} status={read[key]} />
          ))}
        </div>
      )}

      {/* Call controls, bottom-centre. */}
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
        <ControlButton
          label={cameraOn ? "Turn camera off" : "Turn camera on"}
          active={cameraOn}
          onClick={onToggleCamera}
        >
          <CameraIcon on={cameraOn} />
        </ControlButton>
        <ControlButton label={micOn ? "Mute microphone" : "Unmute microphone"} active={micOn} onClick={onToggleMic}>
          <MicIcon on={micOn} />
        </ControlButton>
        <button
          type="button"
          onClick={onEnd}
          disabled={endDisabled}
          aria-label={endLabel}
          title={endLabel}
          className="flex h-11 items-center gap-2 rounded-full bg-red px-4 text-sm font-medium text-on-accent shadow-sm transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
        >
          <EndIcon />
          <span className="hidden sm:inline">{endLabel}</span>
        </button>
      </div>

      {/* Bottom-left, well clear of the controls and the pills. */}
      <AmbientNudge level={nudgeLevel} corner="bottom-left" />
    </div>
  );
}
