"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Composer from "@/components/advisor/Composer";
import MessageBubble from "@/components/advisor/MessageBubble";
import CuePoints from "./CuePoints";
import { MODES, MODE_ORDER } from "@/lib/modes";
import type { MicMode, VoiceLoop } from "@/lib/voice-loop";
import type { CuePoint, Message, ModeId } from "@/lib/types";

/**
 * The right-hand panel: the cue points, and where the user says the next thing.
 *
 * It does NOT show what the coach said, and that is the point. You do not read
 * along while someone talks to you; you listen and you answer. The coach speaks
 * with a face and a voice, and reading its words a second and a half ahead of
 * hearing them was the single thing most making this feel like a chat window
 * with a video stuck on top.
 *
 * The user's own turns are out too, for the same reason. What is left is a mode
 * selector, somewhere to start from, a box, and whatever the room needs to put
 * underneath: the practice chips, and the debrief, which is the one place
 * coaching is allowed to be read rather than heard.
 *
 * What sits here instead is the running list of cue points: the two or three
 * things worth carrying from each exchange, kept for the whole session. They
 * are what a transcript was actually for, minus the part that made the room
 * feel like a chat window.
 *
 * Nothing is lost. The full conversation is saved exactly as before and is
 * readable in History, which is where you go to review rather than to talk.
 *
 * The exception is a coach that cannot speak: with read-aloud off, or a browser
 * with no speech at all, the text IS the conversation and hiding it would leave
 * a room where nothing happens.
 *
 * The mode selector lives at the top of this panel rather than on its own
 * screen. Switching mode is a small decision about tone, not a destination.
 */

const ACCENT_CHIP: Record<string, string> = {
  coral: "border-coral bg-coral/12 text-ink",
  blue: "border-blue bg-blue/12 text-ink",
  amber: "border-amber bg-amber/18 text-ink",
};

function TranscriptIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" strokeWidth={1.8}>
      <rect x="4" y="3.5" width="16" height="17" rx="3" stroke="currentColor" />
      <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function CueIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" strokeWidth={1.8}>
      <path d="M5 7h14M5 12h14M5 17h8" stroke="currentColor" strokeLinecap="round" />
      <circle cx="19" cy="17" r="2.2" stroke="currentColor" />
    </svg>
  );
}

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
  /** False on the live page while the coach can be heard. */
  showTranscript,
  cues,
  draft,
  onDraftChange,
  onSend,
  onStop,
  voice,
  autoSend,
  onToggleAutoSend,
  micMode,
  onMicModeChange,
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
  showTranscript: boolean;
  cues: CuePoint[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  voice: VoiceLoop;
  autoSend: boolean;
  onToggleAutoSend: () => void;
  micMode: MicMode;
  onMicModeChange: (mode: MicMode) => void;
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
      aria-label={showTranscript ? "Transcript" : "Cue points"}
      className="flex min-h-[55vh] min-w-0 flex-col border-t border-line bg-card md:h-full md:min-h-0 md:w-[380px] md:shrink-0 md:border-t-0 md:border-l lg:w-[420px]"
    >
      <header className="shrink-0 border-b px-4 py-3 hairline">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-ink-2"
          >
            {showTranscript ? <TranscriptIcon /> : <CueIcon />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {showTranscript ? "Transcript" : "Cue points"}
            </p>
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
        {showTranscript ? (
          <>
            <MessageBubble role="assistant" content={MODES[mode].opener} />
            {messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} content={m.content} />
            ))}
            {busy && <MessageBubble role="assistant" content={streamText} pending />}
          </>
        ) : (
          <CuePoints cues={cues} pending={busy} />
        )}
        {children}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t px-3 pb-3 pt-2.5 hairline">
        <Composer
          value={draft}
          onChange={onDraftChange}
          onSend={onSend}
          onStop={onStop}
          busy={busy}
          placeholder={placeholder}
          hint={hint}
          voice={voice}
          autoSend={autoSend}
          onToggleAutoSend={onToggleAutoSend}
          micMode={micMode}
          onMicModeChange={onMicModeChange}
          micOn={micOn}
        />
        <p className="mt-1.5 px-1 text-center text-[11px] leading-relaxed text-ink-3">{footnote}</p>
      </div>
    </section>
  );
}
