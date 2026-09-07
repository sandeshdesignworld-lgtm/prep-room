"use client";

import type { RefObject } from "react";
import CoachFace from "./CoachFace";
import SelfView from "./SelfView";
import type { AvatarFailure, AvatarStatus } from "@/lib/avatar";
import type { LiveRead } from "@/lib/signals-math";

/**
 * The room, seen from the user's side of the table.
 *
 * The coach is the hero and stays the hero: you land in a conversation with
 * someone, not a menu, and the same face gives the advice and then plays the
 * interviewer. The user's own camera is a corner picture while they are
 * explaining a problem, and takes half the stage the moment a rehearsal starts,
 * because that is when what their body is doing becomes the thing being
 * practised.
 *
 * The stage is capped rather than stretched to whatever the window offers. A
 * call tile is a fixed thing you sit in front of; a stage that grows with the
 * browser leaves a small face adrift in a field of grey, which is what this
 * was. The cap is portrait, because the avatar is, so the picture fills the
 * frame instead of being letterboxed inside it.
 */

/**
 * A contained tile, centred, portrait to match the avatar. Capped in both
 * directions so a large monitor gets more room around the room, not a
 * life-size head.
 */
const STAGE = [
  "mx-auto w-full",
  "max-w-[min(100%,30rem)] md:max-w-[min(100%,34rem)]",
  "md:max-h-[min(100%,40rem)]",
].join(" ");

/**
 * Shorter, for when there is no avatar to fill it.
 *
 * A portrait frame is the right shape around a person and the wrong shape
 * around a monogram: the same box that fits the coach exactly leaves a small
 * circle stranded in the middle of it. Voice-only is a complete way to run this
 * app, not a broken one, and it should not look like a picture failed to load.
 *
 * Chosen from the SETTING, not from whether the avatar has finished loading.
 * AvatarKit sizes its canvas to this box through a ResizeObserver, so a box
 * that changes height the moment the coach arrives makes the renderer catch up
 * mid-frame. The setting is known before the SDK mounts and does not move.
 */
const STAGE_VOICE_ONLY = [
  "mx-auto w-full",
  "max-w-[min(100%,30rem)] md:max-w-[min(100%,34rem)]",
  "md:max-h-[min(100%,22rem)]",
].join(" ");

/** Split for a rehearsal it holds two panes, so it is allowed to be wider. */
const STAGE_SPLIT = "mx-auto w-full max-w-full md:max-h-[min(100%,36rem)]";

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

function FaceIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.8}>
      <circle cx="12" cy="9" r="4" stroke="currentColor" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeLinecap="round" />
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

export default function Stage({
  avatarContainerRef,
  avatarStatus,
  avatarFailure,
  avatarOn,
  onToggleAvatar,
  onAvatarFail,
  coachSpeaking,
  presence,
  videoRef,
  cameraLive,
  read,
  nudgeLevel,
  cameraMessage,
  /** A rehearsal is running, so the user's own read is what matters. */
  practising,
  cameraOn,
  micOn,
  onToggleCamera,
  onToggleMic,
  onEnd,
  endLabel,
  endDisabled,
}: {
  avatarContainerRef: RefObject<HTMLDivElement | null>;
  avatarStatus: AvatarStatus;
  avatarFailure: AvatarFailure | null;
  avatarOn: boolean;
  onToggleAvatar: () => void;
  onAvatarFail: (reason: "crashed") => void;
  coachSpeaking: boolean;
  presence: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraLive: boolean;
  read: LiveRead | null;
  nudgeLevel: number | null;
  cameraMessage?: string;
  practising: boolean;
  cameraOn: boolean;
  micOn: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onEnd: () => void;
  endLabel: string;
  endDisabled: boolean;
}) {
  return (
    <div
      className={[
        "relative flex h-[42vh] w-full shrink-0 flex-col overflow-hidden rounded-2xl border bg-fill hairline",
        "md:h-auto md:min-h-0 md:flex-1 md:flex-row",
        practising ? STAGE_SPLIT : avatarOn ? STAGE : STAGE_VOICE_ONLY,
      ].join(" ")}
    >
      <div className={practising ? "relative min-h-0 min-w-0 flex-1" : "absolute inset-0"}>
        <CoachFace
          containerRef={avatarContainerRef}
          status={avatarStatus}
          failure={avatarFailure}
          speaking={coachSpeaking}
          presence={presence}
          onFail={onAvatarFail}
        />
      </div>

      {/* Two positioning modes, not a transition: a corner picture and half the
          stage are different things, and pretending one slides into the other
          would animate a layout change nobody asked to watch. */}
      <div
        className={
          practising
            ? "relative min-h-0 min-w-0 flex-1 border-t border-line/60 md:border-l md:border-t-0"
            : "absolute right-3 top-3 z-10 aspect-[4/3] w-32 overflow-hidden rounded-xl border border-line/60 shadow-lg sm:w-40"
        }
      >
        <SelfView
          videoRef={videoRef}
          live={cameraLive}
          read={read}
          nudgeLevel={nudgeLevel}
          message={cameraMessage}
          large={practising}
        />
      </div>

      <div className="absolute inset-x-0 bottom-3 z-20 flex items-center justify-center gap-2">
        <ControlButton
          label={cameraOn ? "Turn camera off" : "Turn camera on"}
          active={cameraOn}
          onClick={onToggleCamera}
        >
          <CameraIcon on={cameraOn} />
        </ControlButton>
        <ControlButton
          label={micOn ? "Mute microphone" : "Unmute microphone"}
          active={micOn}
          onClick={onToggleMic}
        >
          <MicIcon on={micOn} />
        </ControlButton>
        <ControlButton
          label={avatarOn ? "Hide your coach's avatar" : "Show your coach's avatar"}
          active={avatarOn}
          onClick={onToggleAvatar}
        >
          <FaceIcon on={avatarOn} />
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
    </div>
  );
}
