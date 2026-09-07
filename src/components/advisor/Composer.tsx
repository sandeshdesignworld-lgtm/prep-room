"use client";

import { useEffect, useRef } from "react";
import { dictationErrorCopy } from "@/lib/speech";
import { joinSpoken } from "@/lib/speech-text";
import { SILENCE_MS } from "@/lib/voice-activity";
import type { MicMode, VoiceLoop } from "@/lib/voice-loop";

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" strokeWidth={1.8}>
      <rect x="9" y="3" width="6" height="11" rx="3" fill={active ? "currentColor" : "none"} stroke="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The countdown before an auto-send. Deliberately quiet: a hairline that drains
 * and one short line of text. It is a warning, not a demand, and the way to
 * cancel it is to carry on talking, which is what someone mid-thought is doing
 * anyway. Tapping it works too, for anyone who'd rather use their hands.
 */
function SendingIn({ remainingMs, onCancel }: { remainingMs: number; onCancel: () => void }) {
  const left = Math.max(0, Math.min(1, remainingMs / SILENCE_MS));
  return (
    <button
      type="button"
      onClick={onCancel}
      className="mb-1 block w-full rounded-lg px-2 pb-1 pt-0.5 text-left transition-colors hover:bg-fill-2"
    >
      <span aria-hidden className="block h-0.5 w-full overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-blue transition-[width] duration-100 ease-linear"
          style={{ width: `${left * 100}%` }}
        />
      </span>
      <span className="mt-1 block text-xs text-ink-2" role="status">
        Sending in {(remainingMs / 1000).toFixed(1)}s. Keep talking to hold it.
      </span>
    </button>
  );
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  hint,
  voice,
  autoSend,
  onToggleAutoSend,
  micMode,
  onMicModeChange,
  micOn,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Takes the text explicitly, so the phrase still being recognised isn't lost. */
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  hint: string;
  voice: VoiceLoop;
  autoSend: boolean;
  onToggleAutoSend: () => void;
  micMode: MicMode;
  onMicModeChange: (mode: MicMode) => void;
  /**
   * False when the call's mic is muted. The mic button disappears rather than
   * sitting there disabled, so there is one obvious place to unmute: the call
   * controls, the same as any other call.
   */
  micOn: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { listening, interim, error, countdownMs, cancelPending } = voice;
  const supported = voice.supported && micOn;

  // What's shown includes the phrase still being recognised; what's committed doesn't.
  const shown = listening && interim ? joinSpoken(value, interim) : value;

  // Grow with the text instead of scrolling inside a two-line box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [shown]);

  const canSend = shown.trim().length > 0 && !busy;

  /** The manual path. Same send as auto-send takes, just pulled by hand. */
  function submit() {
    const text = shown.trim();
    if (!text || busy) return;
    voice.stop();
    onSend(text);
  }

  const tap = micMode === "tap";
  const status = error
    ? dictationErrorCopy(error)
    : voice.heldForCoach
      ? "Your coach is talking. The mic comes back when they finish."
      : listening
        ? tap
          ? "Listening. Tap the mic again when you're done."
          : autoSend
            ? "Listening. Stop talking and it sends on its own."
            : "Listening. Tap the mic when you're done."
        : tap
          ? "Tap the mic, say your piece, tap it again."
          : hint;

  return (
    <div
      className={[
        "rounded-2xl border bg-card p-2 transition-colors",
        listening ? "border-blue" : "hairline",
      ].join(" ")}
    >
      {countdownMs !== null && (
        <SendingIn remainingMs={countdownMs} onCancel={cancelPending} />
      )}

      <textarea
        ref={ref}
        rows={1}
        value={shown}
        onChange={(e) => {
          // Typing takes over from the mic rather than fighting it.
          if (listening) voice.stop();
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-2.5 py-2 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
      />
      <div className="flex items-center justify-between gap-3 px-1 pb-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {supported && (
            <button
              type="button"
              onClick={voice.toggle}
              disabled={voice.heldForCoach}
              aria-pressed={listening}
              aria-label={
                voice.heldForCoach
                  ? "Your coach is talking"
                  : listening
                    ? "Stop listening"
                    : "Speak instead of typing"
              }
              className={[
                "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                voice.heldForCoach
                  ? "text-ink-3"
                  : listening
                    ? "bg-blue-strong text-on-blue-strong"
                    : "text-ink-2 hover:bg-fill-2 hover:text-ink",
              ].join(" ")}
            >
              {listening && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full bg-blue/40"
                />
              )}
              <span className="relative">
                <MicIcon active={listening} />
              </span>
            </button>
          )}
          {supported && (
            <div className="flex shrink-0 items-center gap-1">
              {/* Two ways to use a microphone, one switch. Hands-free is better
                  where it works; tap to talk is the one that works anywhere. */}
              <div className="flex overflow-hidden rounded-full border hairline">
                {(
                  [
                    { id: "auto" as const, label: "Hands free", hint: "Picks up when you talk, sends when you stop" },
                    { id: "tap" as const, label: "Tap to talk", hint: "Listens only between taps. Better in a noisy room" },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onMicModeChange(opt.id)}
                    aria-pressed={micMode === opt.id}
                    title={opt.hint}
                    className={[
                      "px-2 py-0.5 text-[11px] font-medium transition-colors",
                      micMode === opt.id
                        ? "bg-blue/12 text-ink"
                        : "bg-card text-ink-3 hover:bg-fill",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {!tap && (
                <button
                  type="button"
                  onClick={onToggleAutoSend}
                  aria-pressed={autoSend}
                  title={
                    autoSend
                      ? `Your turn sends itself after ${SILENCE_MS / 1000}s of quiet`
                      : "You send each turn yourself"
                  }
                  className={[
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    autoSend
                      ? "border-blue bg-blue/12 text-ink"
                      : "hairline bg-card text-ink-3 hover:bg-fill",
                  ].join(" ")}
                >
                  Auto-send {autoSend ? "on" : "off"}
                </button>
              )}
            </div>
          )}
          <span
            className={`truncate text-xs ${error ? "text-red" : "text-ink-3"}`}
            role={error ? "alert" : undefined}
          >
            {status}
          </span>
        </div>

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="shrink-0 rounded-lg bg-coral px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-coral-hover disabled:pointer-events-none disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
