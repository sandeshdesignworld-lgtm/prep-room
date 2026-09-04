"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CallStage from "./CallStage";
import CoachPanel from "./CoachPanel";
import SignalCards from "./SignalCards";
import MessageBubble from "@/components/advisor/MessageBubble";
import DebriefCard from "@/components/practice/DebriefCard";
import { DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_NOTE } from "@/lib/scenario";
import { getMode } from "@/lib/modes";
import { useSpeaker } from "@/lib/speech";
import { CAPTURE_MESSAGE, downsample, summariseSignals, useSignalCapture } from "@/lib/signals";
import { newMessage, newSession, saveProfile, saveSession, titleFor } from "@/lib/storage";
import type {
  Debrief,
  Difficulty,
  Message,
  ModeId,
  Profile,
  Roleplay,
  Scenario,
  Session,
  SignalSample,
} from "@/lib/types";

/**
 * The room. Camera in the middle, coach on the right, and one session running
 * through both: advice first, then a rehearsal against a counterpart cast from
 * that advice, then the debrief.
 *
 * The rule that shapes all of it: no coaching lands mid-roleplay. While a
 * rehearsal is live the panel is the counterpart in character and nothing else,
 * and the only thing on the video is the user's own read. The score and the
 * notes arrive afterwards.
 */

/** The coach is told to offer a rehearsal once it's given advice; this spots that. */
const OFFERS_PRACTICE = /\b(practis|practic|role-?play|rehears|try it out loud|run through it)/i;

type PracticeStage = "off" | "setup" | "starting" | "live" | "debriefing" | "done";

export default function Room({
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

  const [stage, setStage] = useState<PracticeStage>("off");
  const [difficulty, setDifficulty] = useState<Difficulty>("realistic");
  const [roleplayTurns, setRoleplayTurns] = useState<Message[]>([]);
  const [signals, setSignals] = useState<SignalSample[]>([]);

  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(profile.inputPreference === "voice");
  const [speakOn, setSpeakOn] = useState(profile.speakReplies);

  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<string>(new Date().toISOString());
  /** One read per rehearsal: a camera toggled off mid-practice doesn't restart it. */
  const analysedRef = useRef(false);

  const mode = getMode(session.mode);
  const scenario = session.roleplay?.scenario ?? null;
  const live = stage === "live";

  const speaker = useSpeaker({ enabled: speakOn, speaker: profile.voice });
  // Destructured because useSpeaker hands back a fresh object every render, so
  // anything depending on `speaker` itself is rebuilt on every render.
  const {
    cancel: cancelSpeech,
    reset: resetSpeech,
    feed: feedSpeech,
    flush: flushSpeech,
    supported: speakSupported,
  } = speaker;

  const capture = useSignalCapture();
  const {
    status: captureStatus,
    analysis,
    read,
    level,
    videoRef,
    startCamera,
    stopCamera,
    startAnalysis,
    endAnalysis,
    markTurn,
  } = capture;

  /* --------------------------- camera and read ---------------------------- */

  // Entering the room turns the camera on, the way joining a call does. The
  // toggle is authoritative from then on.
  useEffect(() => {
    if (cameraOn && captureStatus === "idle") void startCamera();
    if (!cameraOn && captureStatus !== "idle") stopCamera();
  }, [cameraOn, captureStatus, startCamera, stopCamera]);

  // Body language is only read during a rehearsal. Outside one the models
  // aren't even loaded: watching someone type a question measures nothing.
  useEffect(() => {
    if (live && captureStatus === "running" && analysis === "off" && !analysedRef.current) {
      analysedRef.current = true;
      void startAnalysis();
    }
  }, [live, captureStatus, analysis, startAnalysis]);

  const nudgeLevel = profile.ambientNudge && analysis === "on" ? level : null;

  /* ------------------------------ persistence ----------------------------- */

  const persist = useCallback((next: Session) => {
    const stamped = { ...next, title: titleFor(next), updatedAt: new Date().toISOString() };
    saveSession(stamped);
    setSession(stamped);
    return stamped;
  }, []);

  /* --------------------------- the advice thread -------------------------- */

  /** Streams one coach reply onto the end of `base`. Never appends a user turn. */
  const requestReply = useCallback(
    async (base: Session) => {
      setError(null);
      setBusy(true);
      setStreamText("");
      cancelSpeech();
      resetSpeech();

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
          feedSpeech(received);
        }
        received += decoder.decode();
        flushSpeech(received);

        if (received.trim()) {
          persist({
            ...base,
            messages: [...base.messages, newMessage("assistant", received.trim())],
          });
        } else {
          setError("The coach went quiet. Try sending that again.");
        }
      } catch (err) {
        if (controller.signal.aborted) {
          cancelSpeech();
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
    [persist, profile.about, profile.goal, cancelSpeech, resetSpeech, feedSpeech, flushSpeech]
  );

  /* ----------------------------- the rehearsal ---------------------------- */

  const counterpartReply = useCallback(
    async (history: Message[]) => {
      const active = scenario;
      if (!active) return;
      setBusy(true);
      setStreamText("");
      setError(null);
      cancelSpeech();
      resetSpeech();

      let received = "";
      try {
        const res = await fetch("/api/roleplay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: session.mode,
            scenario: active,
            messages: history.map(({ role, content }) => ({ role, content })),
          }),
        });
        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error ?? "They went quiet. Try that again.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
          setStreamText(received);
          feedSpeech(received);
        }
        received += decoder.decode();
        flushSpeech(received);

        if (received.trim()) {
          setRoleplayTurns((prev) => [...prev, newMessage("assistant", received.trim())]);
        } else {
          setError("They went quiet. Try that again.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setBusy(false);
        setStreamText("");
      }
    },
    [scenario, session.mode, cancelSpeech, resetSpeech, feedSpeech, flushSpeech]
  );

  async function beginPractice() {
    setStage("starting");
    setError(null);
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: session.mode,
          difficulty,
          messages: session.messages.map(({ role, content }) => ({ role, content })),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "Couldn't set this up. Try again.");

      const cast = payload as Scenario;

      startedAtRef.current = new Date().toISOString();
      analysedRef.current = false;
      setRoleplayTurns([]);
      setSignals([]);
      setSession((current) => ({
        ...current,
        debrief: undefined,
        roleplay: { scenario: cast, messages: [], startedAt: startedAtRef.current },
      }));
      setStage("live");
      if (cast.opening && speakOn) {
        resetSpeech();
        flushSpeech(cast.opening);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set this up. Try again.");
      setStage("setup");
    }
  }

  async function endPractice() {
    if (!scenario) return;
    cancelSpeech();
    setStage("debriefing");
    setError(null);

    // Raw ~15Hz samples never leave this function; only the rollup text goes to
    // the server, and only a 1Hz version is kept for the chart. No frame of
    // video has left the device at any point, and none is about to.
    const raw = endAnalysis();
    const userLines = roleplayTurns.filter((t) => t.role === "user").map((t) => t.content);
    const signalSummary = summariseSignals(raw, userLines);
    const kept = downsample(raw);
    setSignals(kept);

    try {
      const res = await fetch("/api/debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: session.mode,
          scenario,
          messages: roleplayTurns.map(({ role, content }) => ({ role, content })),
          signalSummary,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "Couldn't put the debrief together.");

      const result = payload as Debrief;
      const roleplay: Roleplay = {
        scenario,
        messages: roleplayTurns,
        startedAt: startedAtRef.current,
        endedAt: new Date().toISOString(),
        signals: kept,
      };
      persist({ ...session, roleplay, debrief: result });
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put the debrief together.");
      setStage("live");
    }
  }

  /* -------------------------------- actions ------------------------------- */

  function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");

    if (live) {
      const next = [...roleplayTurns, newMessage("user", text)];
      // Index among the user's own turns, which is what the debrief counts.
      markTurn(next.filter((t) => t.role === "user").length - 1);
      setRoleplayTurns(next);
      void counterpartReply(next);
      return;
    }

    const withUser = persist({
      ...session,
      messages: [...session.messages, newMessage("user", text)],
    });
    void requestReply(withUser);
  }

  function stop() {
    abortRef.current?.abort();
    cancelSpeech();
  }

  /** The last turn is already the user's, so just ask again rather than re-appending it. */
  function retry() {
    if (busy) return;
    if (live) {
      void counterpartReply(roleplayTurns);
      return;
    }
    void requestReply(session);
  }

  function toggleSpeak() {
    const next = !speakOn;
    setSpeakOn(next);
    if (!next) cancelSpeech();
    saveProfile({ ...profile, speakReplies: next });
  }

  function startFresh(nextMode: ModeId = session.mode) {
    stop();
    if (analysis !== "off") endAnalysis();
    analysedRef.current = false;
    setError(null);
    setStage("off");
    setRoleplayTurns([]);
    setSignals([]);
    setStreamText("");
    setDraft("");
    setSession(newSession(nextMode));
  }

  function switchMode(next: ModeId) {
    if (next === session.mode) return;
    if (session.messages.length === 0 && stage === "off") {
      setSession({ ...session, mode: next });
      return;
    }
    startFresh(next);
  }

  /** The red button. In a rehearsal it ends the rehearsal; otherwise it leaves the call. */
  function endCall() {
    if (live) {
      void endPractice();
      return;
    }
    cancelSpeech();
    setCameraOn(false);
  }

  /* -------------------------------- render -------------------------------- */

  const lastCoachLine = useMemo(() => {
    const last = session.messages[session.messages.length - 1];
    return last?.role === "assistant" ? last.content : "";
  }, [session.messages]);

  const offersPractice = !busy && stage === "off" && OFFERS_PRACTICE.test(lastCoachLine);

  // Only offer a retry when the last thing said was the user's, which is the
  // only case where asking again doesn't duplicate a turn.
  const lastTurn = live
    ? roleplayTurns[roleplayTurns.length - 1]
    : session.messages[session.messages.length - 1];
  const canRetry = !busy && lastTurn?.role === "user";

  const presence = live
    ? `${scenario?.counterpart ?? "In character"} · rehearsing`
    : busy
      ? "Coach · thinking"
      : "Coach · live";

  const cameraMessage = cameraOn
    ? (CAPTURE_MESSAGE[captureStatus as keyof typeof CAPTURE_MESSAGE] ?? "")
    : "Camera off. The coach still hears you, and there'll be no delivery notes.";

  const restingNote =
    analysis === "loading"
      ? "Warming up…"
      : !cameraOn
        ? "Camera off"
        : stage === "off"
          ? "Reads while you rehearse"
          : "Resting";

  const panelExtras = (
    <>
      {session.messages.length === 0 && stage === "off" && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-ink-3">Or start from one of these:</p>
          {mode.starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                const withUser = persist({
                  ...session,
                  messages: [...session.messages, newMessage("user", s)],
                });
                void requestReply(withUser);
              }}
              className="block w-full rounded-xl border bg-card hairline px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-fill hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {offersPractice && !session.debrief && (
        <button
          type="button"
          onClick={() => setStage("setup")}
          className="rounded-full bg-coral px-4 py-2 text-sm font-medium text-on-accent shadow-sm transition-colors hover:bg-coral-hover"
        >
          Practise this out loud
        </button>
      )}

      {stage === "setup" && (
        <div className="space-y-3 rounded-xl border bg-fill-2 hairline p-3">
          <p className="text-sm font-medium text-ink">
            I&apos;ll play {mode.counterpart} and stay in character. No coaching while we&apos;re in
            it, that comes after.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                aria-pressed={difficulty === d}
                title={DIFFICULTY_NOTE[d]}
                className={[
                  "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                  difficulty === d
                    ? "border-blue bg-blue/12 text-ink"
                    : "bg-card text-ink-2 hairline hover:bg-fill",
                ].join(" ")}
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={beginPractice}
              className="rounded-lg bg-coral px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-coral-hover"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => setStage("off")}
              className="rounded-lg px-2 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-fill hover:text-ink"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {stage === "starting" && <p className="py-2 text-sm text-ink-2">Setting the scene…</p>}

      {scenario && stage !== "off" && stage !== "setup" && stage !== "starting" && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
              Practice · {scenario.counterpart}
            </span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </div>
          {scenario.opening && <MessageBubble role="assistant" content={scenario.opening} />}
          {roleplayTurns.map((t) => (
            <MessageBubble key={t.id} role={t.role} content={t.content} />
          ))}
        </div>
      )}

      {stage === "debriefing" && <p className="py-2 text-sm text-ink-2">Looking back over that…</p>}

      {stage === "done" && session.debrief && (
        <div className="space-y-2">
          <DebriefCard
            debrief={session.debrief}
            scenario={session.roleplay?.scenario}
            signals={signals.length ? signals : session.roleplay?.signals}
          />
          <button
            type="button"
            onClick={() => setStage("setup")}
            className="text-sm font-medium text-blue-strong underline underline-offset-2"
          >
            Run it again
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red/40 bg-red/8 px-3 py-2.5">
          <p className="text-sm text-ink">{error}</p>
          {canRetry && (
            <button
              type="button"
              onClick={retry}
              className="mt-1.5 text-sm font-medium text-blue-strong underline underline-offset-2"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-full flex-col md:h-full md:min-h-0 md:flex-row">
      <div className="flex min-w-0 flex-col gap-2.5 p-3 md:min-h-0 md:flex-1 md:p-4">
        <CallStage
          videoRef={videoRef}
          live={captureStatus === "running"}
          read={read}
          nudgeLevel={nudgeLevel}
          cameraOn={cameraOn}
          micOn={micOn}
          onToggleCamera={() => setCameraOn((v) => !v)}
          onToggleMic={() => setMicOn((v) => !v)}
          onEnd={endCall}
          endLabel={live ? "End practice" : "End"}
          endDisabled={!live && !cameraOn}
          presence={presence}
          message={cameraMessage}
        />
        <SignalCards read={read} restingNote={restingNote} />
      </div>

      <CoachPanel
        mode={session.mode}
        onModeChange={switchMode}
        messages={session.messages}
        streamText={streamText}
        busy={busy}
        speakOn={speakOn}
        speakSupported={speakSupported}
        onToggleSpeak={toggleSpeak}
        onNewConversation={() => startFresh()}
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        onStop={stop}
        onDictationStart={cancelSpeech}
        micOn={micOn}
        placeholder={live ? "Say your line…" : mode.composerPlaceholder}
        hint={
          live
            ? "Feedback comes after. Hit End practice when you're done."
            : micOn
              ? "Tap the mic and just talk."
              : "Enter to send, Shift+Enter for a new line."
        }
        footnote={mode.disclaimer ?? "Saved on this device only. No video ever leaves it."}
      >
        {panelExtras}
      </CoachPanel>
    </div>
  );
}
