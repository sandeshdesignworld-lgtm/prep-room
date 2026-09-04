"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Composer from "@/components/advisor/Composer";
import MessageBubble from "@/components/advisor/MessageBubble";
import { MODES, MODE_ORDER } from "@/lib/modes";
import type { Message, ModeId } from "@/lib/types";

/**
 * The conversation, on the right. It carries the whole session: the advice
 * thread and, once a rehearsal starts, the roleplay turns underneath it, so
 * there is one continuous record of what was said rather than two.
 *
 * The mode selector lives at the top of this panel rather than on its own
 * screen. Switching mode is a small decision about tone, not a destination.
 */

const ACCENT_CHIP: Record<string, string> = {
  coral: "border-coral bg-coral/12 text-ink",
  blue: "border-blue bg-blue/12 text-ink",
  amber: "border-amber bg-amber/18 text-ink",
};

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" strokeWidth={1.8}>
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4Z" stroke="currentColor" strokeLinejoin="round" />
      {on ? (
        <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" stroke="currentColor" strokeLinecap="round" />
      ) : (
        <path d="M16 10l4 4m0-4l-4 4" stroke="currentColor" strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function CoachPanel({
  mode,
  onModeChange,
  messages,
  streamText,
  busy,
  speakOn,
  speakSupported,
  onToggleSpeak,
  onNewConversation,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onDictationStart,
  micOn,
  placeholder,
  hint,
  footnote,
  children,
}: {
  mode: ModeId;
  onModeChange: (m: ModeId) => void;
  messages: Message[];
  streamText: string;
  busy: boolean;
  speakOn: boolean;
  speakSupported: boolean;
  onToggleSpeak: () => void;
  onNewConversation: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onDictationStart: () => void;
  micOn: boolean;
  placeholder: string;
  hint: string;
  footnote: string;
  /** Practice chips, roleplay turns, the debrief: whatever the room adds below the thread. */
  children?: ReactNode;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamText, children]);

  return (
    <section
      aria-label="Coach"
      className="flex min-h-[55vh] min-w-0 flex-col border-t border-line bg-card md:h-full md:min-h-0 md:w-[380px] md:shrink-0 md:border-t-0 md:border-l lg:w-[420px]"
    >
      <header className="shrink-0 border-b px-4 py-3 hairline">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-coral/12 text-sm font-semibold text-coral"
          >
            PR
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">Your coach</p>
            <p className="truncate text-xs text-ink-2">{MODES[mode].tagline}</p>
          </div>
          {speakSupported && (
            <button
              type="button"
              onClick={onToggleSpeak}
              aria-pressed={speakOn}
              aria-label={speakOn ? "Stop reading replies aloud" : "Read replies aloud"}
              className={[
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                speakOn ? "bg-blue/12 text-blue-strong" : "text-ink-3 hover:bg-fill hover:text-ink-2",
              ].join(" ")}
            >
              <SpeakerIcon on={speakOn} />
            </button>
          )}
          <button
            type="button"
            onClick={onNewConversation}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-fill hover:text-ink"
          >
            New
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {MODE_ORDER.map((id) => {
            const m = MODES[id];
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onModeChange(id)}
                aria-pressed={active}
                className={[
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active ? ACCENT_CHIP[m.accent] : "hairline bg-card text-ink-2 hover:bg-fill",
                ].join(" ")}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <MessageBubble role="assistant" content={MODES[mode].opener} />
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {busy && <MessageBubble role="assistant" content={streamText} pending />}
        {children}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t px-3 pb-3 pt-2.5 hairline">
        <Composer
          value={draft}
          onChange={onDraftChange}
          onSend={onSend}
          onStop={onStop}
          onDictationStart={onDictationStart}
          busy={busy}
          placeholder={placeholder}
          hint={hint}
          voiceEnabled={micOn}
        />
        <p className="mt-1.5 px-1 text-center text-[11px] leading-relaxed text-ink-3">{footnote}</p>
      </div>
    </section>
  );
}
