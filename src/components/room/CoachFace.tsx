"use client";

import type { RefObject } from "react";
import AvatarBoundary from "./AvatarBoundary";
import type { AvatarStatus } from "@/lib/avatar";
import BrandMark from "@/components/app/BrandMark";

/**
 * The coach, centre stage. Present from the first message: you land in a room
 * with someone in it, tell them the problem, get advice, and then they offer to
 * run the thing with you. Same person throughout, which is the whole point of
 * having a face at all.
 *
 * When the avatar is off, unavailable or has failed, this is a monogram that
 * pulses while the coach speaks. That fallback is not a placeholder for a
 * missing feature, it is the app as it has always worked, and nothing else on
 * screen changes when it appears, INCLUDING any explanation of why.
 *
 * Nothing about how this works reaches the page. No reason, no error, no note
 * about credentials or read-aloud or a motion server. Someone is here to
 * rehearse a conversation they are dreading; a machine explaining itself to
 * them is noise at best, and at worst it makes a perfectly good voice-only
 * session look broken. Every one of those reasons is logged instead, in one
 * line, for whoever is building this. See lib/avatar.ts.
 */

function Monogram({ speaking }: { speaking: boolean }) {
  return (
    <span className="relative flex h-20 w-20 items-center justify-center">
      {speaking && (
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-coral/20"
          style={{ animationDuration: "1.8s" }}
        />
      )}
      <span
        aria-hidden
        className="relative flex h-20 w-20 items-center justify-center rounded-full bg-coral/12"
      >
        <BrandMark size={44} />
      </span>
    </span>
  );
}



export default function CoachFace({
  containerRef,
  status,
  speaking,
  presence,
  onFail,
}: {
  /** Where AvatarKit mounts its canvas. Must be a sized, non-zero box. */
  containerRef: RefObject<HTMLDivElement | null>;
  status: AvatarStatus;
  /** True while the coach is talking, whichever way the audio is coming out. */
  speaking: boolean;
  /** The chip in the top-left: what the coach is doing right now. */
  presence: string;
  onFail: (reason: "crashed") => void;
}) {
  const ready = status === "ready";

  return (
    <div className="relative h-full w-full overflow-hidden bg-fill">
      <AvatarBoundary onFail={() => onFail("crashed")}>
        {/* Stays mounted across status changes: the SDK owns the canvas inside
            it, so swapping this box out from under it would strand the renderer. */}
        {/* Fills the stage, because the stage is now the size of the coach.
            Holding the avatar to a small box inside a large one is what left a
            face marooned in grey; the size is decided by the frame around this
            (see Stage), and here the picture simply fills what it is given. */}
        <div
          ref={containerRef}
          aria-hidden
          className={[
            "absolute inset-0 transition-opacity duration-700",
            ready ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
        />
      </AvatarBoundary>

      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <Monogram speaking={speaking} />
          {status === "loading" && (
            <p className="text-sm text-ink-2">Bringing your coach in…</p>
          )}
        </div>
      )}

      {/* The counterpart is cast as a director would write it, so this line can
          run long. It's a status chip, not a label: one line, clipped. */}
      <div
        title={presence}
        className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-card/92 px-2.5 py-1 text-xs font-medium text-ink shadow-sm backdrop-blur-sm"
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span
            aria-hidden
            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue/70"
          />
          <span aria-hidden className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
        </span>
        <span className="truncate">{presence}</span>
      </div>
    </div>
  );
}
