"use client";

import type { RefObject } from "react";
import AmbientNudge from "@/components/practice/AmbientNudge";
import type { LiveRead, SignalStatus } from "@/lib/signals-math";

/**
 * The user, watching themselves. Mirrored, because an unmirrored self-view is
 * disconcerting: you reach left and the person in front of you reaches right.
 *
 * Small and out of the way while they are talking a problem through, because
 * nobody needs to study their own face to ask a question. Large once a
 * rehearsal starts, because that is when their body language is the thing being
 * practised, and the pills belong on it.
 *
 * The pills are the only live feedback anywhere in a roleplay, and they are
 * feedback in the weakest sense: two words and a coloured dot. No score, no
 * sentence, no voice, no advice, nothing that names a feeling. The coaching
 * happens in the debrief, after.
 *
 * Every frame behind this stays on the device. The stream is local, MediaPipe
 * runs on WASM from our own origin, nothing is recorded or uploaded.
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

export default function SelfView({
  videoRef,
  live,
  read,
  nudgeLevel,
  message,
  large,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True once frames are actually arriving. Everything else is a placeholder. */
  live: boolean;
  /** Null while the read is resting, which is any time outside a roleplay. */
  read: LiveRead | null;
  nudgeLevel: number | null;
  /** Why there's no picture, when there isn't one. */
  message?: string;
  /** Split view during a rehearsal, corner picture the rest of the time. */
  large: boolean;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-fill">
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span aria-hidden className="h-2 w-2 rounded-full bg-ink-3" />
          {large && (
            <p className="max-w-sm text-sm leading-relaxed text-ink-2">
              {message ?? "Camera off. Everything else works exactly the same."}
            </p>
          )}
        </div>
      )}

      {/* The live read. Absent entirely while it's resting, which is any time
          outside a rehearsal. */}
      {live && read && (
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1.5">
          {PILL_ORDER.map((key) => (
            <Pill key={key} label={PILL_LABEL[key]} status={read[key]} />
          ))}
        </div>
      )}

      <AmbientNudge level={nudgeLevel} corner="bottom-left" />
    </div>
  );
}
