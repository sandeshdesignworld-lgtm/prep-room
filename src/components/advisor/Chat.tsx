"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";
import { MODES, MODE_ORDER, getMode } from "@/lib/modes";
import { newMessage, newSession, saveProfile, saveSession, titleFor } from "@/lib/storage";
import { useSpeaker } from "@/lib/speech";
import RoleplayPanel from "@/components/practice/RoleplayPanel";
import DebriefCard from "@/components/practice/DebriefCard";
import type { Debrief, ModeId, Profile, Roleplay, Session } from "@/lib/types";

const ACCENT_CHIP: Record<string, string> = {
  poppy: "border-poppy bg-poppy/10 text-ink",
  sage: "border-sage bg-sage/15 text-ink",
  dusty: "border-dusty bg-dusty/12 text-ink",
};

/** The coach is told to offer a rehearsal once it's given advice; this spots that. */
const OFFERS_PRACTICE = /\b(practis|practic|role-?play|rehears|try it out loud|run through it)/i;

export default function Chat({
  profile,
  initialSession,
}: {
  profile: Profile;
  initialSession: Session;
}) {
  const [session, setSession] = useState<Session>(initialSession);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practiceOpen, setPracticeOpen] = useState(false);

  const speaker = useSpeaker({ enabled: profile.speakReplies, speaker: profile.voice });

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const mode = getMode(session.mode);
  const isEmpty = session.messages.length === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, streamText]);

  const persist = useCallback((next: Session) => {
    const stamped = { ...next, title: titleFor(next), updatedAt: new Date().toISOString() };
    saveSession(stamped);
    setSession(stamped);
    return stamped;
  }, []);

  /** Streams one coach reply onto the end of `base`. Never appends a user turn. */
  const requestReply = useCallback(
    async (base: Session) => {
      setError(null);
      setBusy(true);
      setStreamText("");
      speaker.cancel();
      speaker.reset();

      const controller = new AbortController();
      abortRef.current = controller;

      let received = "";
      try {
        const res = await fetch("/api/advisor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            mode: base.mode,
            about: profile.about,
            goal: profile.goal,
            messages: base.messages.map(({ role, content }) => ({ role, content })),
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error ?? "The coach couldn't answer that one.");
        }
        if (!res.body) throw new Error("The coach couldn't answer that one.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
          setStreamText(received);
          speaker.feed(received);
        }
        received += decoder.decode();
        speaker.flush(received);

        if (received.trim()) {
          persist({ ...base, messages: [...base.messages, newMessage("assistant", received.trim())] });
        } else {
          setError("The coach went quiet. Try sending that again.");
        }
      } catch (err) {
        if (controller.signal.aborted) {
          speaker.cancel();
          // Keep whatever arrived before the user hit stop; it's still useful.
          if (received.trim()) {
            persist({
              ...base,
              messages: [...base.messages, newMessage("assistant", received.trim())],
            });
          }
        } else {
          setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStreamText("");
      }
    },
    [persist, profile.about, profile.goal, speaker]
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setPracticeOpen(false);
      setDraft("");
      const withUser = persist({
        ...session,
        messages: [...session.messages, newMessage("user", trimmed)],
      });
      void requestReply(withUser);
    },
    [busy, persist, requestReply, session]
  );

  const savePractice = useCallback(
    (roleplay: Roleplay, debrief: Debrief) => {
      setSession((current) => {
        const next = { ...current, roleplay, debrief, updatedAt: new Date().toISOString() };
        saveSession(next);
        return next;
      });
    },
    []
  );

  /** The last turn is already the user's, so just ask again rather than re-appending it. */
  const retry = useCallback(() => {
    if (busy) return;
    const last = session.messages[session.messages.length - 1];
    if (last?.role !== "user") return;
    void requestReply(session);
  }, [busy, requestReply, session]);

  function stop() {
    abortRef.current?.abort();
    speaker.cancel();
  }

  function switchMode(next: ModeId) {
    if (next === session.mode) return;
    if (isEmpty) {
      setSession({ ...session, mode: next });
      return;
    }
    startFresh(next);
  }

  function startFresh(nextMode: ModeId = session.mode) {
    stop();
    speaker.cancel();
    setError(null);
    setPracticeOpen(false);
    setStreamText("");
    setDraft("");
    setSession(newSession(nextMode));
  }

  const lastCoachLine = useMemo(() => {
    const last = session.messages[session.messages.length - 1];
    return last?.role === "assistant" ? last.content : "";
  }, [session.messages]);

  const showPracticeChip = !busy && OFFERS_PRACTICE.test(lastCoachLine);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4">
      <header className="sticky top-0 z-10 -mx-4 bg-page/92 px-4 pt-4 pb-3 backdrop-blur">
        {/* The brand mark lives in AppShell; repeating it here reads as a bug. */}
        <div className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-1">
            {speaker.supported && (
              <button
                type="button"
                onClick={() => {
                  const next = !profile.speakReplies;
                  if (!next) speaker.cancel();
                  saveProfile({ ...profile, speakReplies: next });
                }}
                aria-pressed={profile.speakReplies}
                className={[
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  profile.speakReplies
                    ? "bg-dusty/12 text-ink"
                    : "text-ink-2 hover:bg-fill-2 hover:text-ink",
                ].join(" ")}
              >
                <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" strokeWidth={1.8}>
                  <path d="M4 9v6h3.5L12 19V5L7.5 9H4Z" stroke="currentColor" strokeLinejoin="round" />
                  {profile.speakReplies ? (
                    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" stroke="currentColor" strokeLinecap="round" />
                  ) : (
                    <path d="M16 10l4 4m0-4l-4 4" stroke="currentColor" strokeLinecap="round" />
                  )}
                </svg>
                {profile.speakReplies ? "Reading aloud" : "Read aloud"}
              </button>
            )}
            <button
              type="button"
              onClick={() => startFresh()}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
            >
              New conversation
            </button>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {MODE_ORDER.map((id) => {
            const m = MODES[id];
            const active = session.mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => switchMode(id)}
                aria-pressed={active}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active ? ACCENT_CHIP[m.accent] : "hairline bg-card text-ink-2 hover:bg-fill-2",
                ].join(" ")}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 space-y-3.5 py-4">
        <MessageBubble role="assistant" content={mode.opener} />

        {isEmpty && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-ink-3">Or start from one of these:</p>
            {mode.starters.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="block w-full rounded-xl border bg-card hairline px-3.5 py-2.5 text-left text-sm text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {session.messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}

        {busy && <MessageBubble role="assistant" content={streamText} pending />}

        {showPracticeChip && !practiceOpen && !session.debrief && (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setPracticeOpen(true)}
              className="rounded-full bg-poppy px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-poppy-hover"
            >
              Practise this out loud
            </button>
          </div>
        )}

        {practiceOpen && (
          <RoleplayPanel
            profile={profile}
            mode={session.mode}
            advisorTurns={session.messages.map(({ role, content }) => ({ role, content }))}
            onFinish={savePractice}
            onClose={() => setPracticeOpen(false)}
          />
        )}

        {/* A finished debrief stays in the thread; it's the point of the session. */}
        {!practiceOpen && session.debrief && (
          <div className="space-y-2">
            <DebriefCard
              debrief={session.debrief}
              scenario={session.roleplay?.scenario}
              signals={session.roleplay?.signals}
            />
            <button
              type="button"
              onClick={() => setPracticeOpen(true)}
              className="text-sm font-medium text-dusty underline underline-offset-2"
            >
              Run it again
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-brick/40 bg-brick/8 px-3.5 py-2.5">
            <p className="text-sm text-ink">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-1.5 text-sm font-medium text-dusty underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 -mx-4 bg-page/92 px-4 pt-2 pb-4 backdrop-blur">
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          onStop={stop}
          onDictationStart={speaker.cancel}
          busy={busy}
          placeholder={mode.composerPlaceholder}
          hint={
            profile.inputPreference === "voice"
              ? "Tap the mic and just talk."
              : "Enter to send, Shift+Enter for a new line."
          }
        />
        <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-ink-3">
          {mode.disclaimer ?? "Saved on this device only. Nothing is uploaded."}
        </p>
      </div>
    </div>
  );
}
