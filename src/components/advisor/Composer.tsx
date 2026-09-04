"use client";

import { useEffect, useRef } from "react";
import { dictationErrorCopy, useDictation } from "@/lib/speech";

/** Joins a dictated phrase onto whatever is already in the box. */
function join(existing: string, addition: string): string {
  if (!existing) return addition;
  return /\s$/.test(existing) ? existing + addition : `${existing} ${addition}`;
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" strokeWidth={1.8}>
      <rect x="9" y="3" width="6" height="11" rx="3" fill={active ? "currentColor" : "none"} stroke="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onDictationStart,
  busy,
  placeholder,
  hint,
  voiceEnabled = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onDictationStart: () => void;
  busy: boolean;
  placeholder: string;
  hint: string;
  /**
   * False when the call's mic is muted. The mic button disappears rather than
   * sitting there disabled, so there is one obvious place to unmute: the call
   * controls, the same as any other call.
   */
  voiceEnabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // onFinal fires from an event handler that outlives this render, so read the
  // draft through a ref rather than the closed-over value.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const dictation = useDictation({
    onFinal: (text) => onChange(join(valueRef.current, text)),
  });
  const { listening, interim, error, start, stop: stopMic } = dictation;
  const supported = dictation.supported && voiceEnabled;

  // Muting mid-phrase has to actually stop the recogniser, not just hide it.
  useEffect(() => {
    if (!voiceEnabled && listening) stopMic();
  }, [voiceEnabled, listening, stopMic]);

  // What's shown includes the phrase still being recognised; what's committed doesn't.
  const shown = listening && interim ? join(value, interim) : value;

  // Grow with the text instead of scrolling inside a two-line box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [shown]);

  const canSend = value.trim().length > 0 && !busy;

  function submit() {
    if (listening) stopMic();
    if (canSend) onSend();
  }

  function toggleMic() {
    if (listening) {
      stopMic();
      return;
    }
    onDictationStart();
    start();
  }

  const status = error
    ? dictationErrorCopy(error)
    : listening
      ? "Listening. Tap the mic when you're done."
      : hint;

  return (
    <div
      className={[
        "rounded-2xl border bg-card p-2 transition-colors",
        listening ? "border-blue" : "hairline",
      ].join(" ")}
    >
      <textarea
        ref={ref}
        rows={1}
        value={shown}
        onChange={(e) => {
          // Typing takes over from the mic rather than fighting it.
          if (listening) stopMic();
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
              onClick={toggleMic}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Speak instead of typing"}
              className={[
                "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                listening
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
