"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Stage from "./Stage";
import CoachPanel from "./CoachPanel";
import SignalCards from "./SignalCards";
import MessageBubble from "@/components/advisor/MessageBubble";
import DebriefCard from "@/components/practice/DebriefCard";
import { DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_NOTE } from "@/lib/scenario";
import { getMode } from "@/lib/modes";
import { useSpeaker } from "@/lib/speech";
import { useAvatar } from "@/lib/avatar";
import { useVoiceLoop } from "@/lib/voice-loop";
import { joinSpoken } from "@/lib/speech-text";
import {
  CAPTURE_MESSAGE,
  detailSignals,
  downsample,
  summariseSignals,
  useSignalCapture,
} from "@/lib/signals";
import { newMessage, newSession, saveProfile, saveSession, titleFor, uid } from "@/lib/storage";
import type {
  CuePoint,
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
  // Older profiles predate the setting, and voice-first is the point, so the
  // absence of a stored preference means on.
  const [autoSend, setAutoSend] = useState(profile.autoSend ?? true);
  // Same rule as auto-send: no stored preference means on. A coach with a face
  // is the default experience; the toggle is for people who'd rather not.
  const [avatarOn, setAvatarOn] = useState(profile.avatar ?? true);

  /**
   * The session as it stands right now, readable from callbacks that outlive
   * the render they were created in. Work that arrives late (a cue request
   * that took three seconds) needs the current thread, not the one that was on
   * screen when it was sent.
   */
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const avatarContainerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<string>(new Date().toISOString());
  /** One read per rehearsal: a camera toggled off mid-practice doesn't restart it. */
  const analysedRef = useRef(false);

  const mode = getMode(session.mode);
  const scenario = session.roleplay?.scenario ?? null;
  const live = stage === "live";

  // The coach's face. Its sink is where the voice goes when it's working, so
  // the mouth and the sound are the same event rather than two that drift.
  //
  // Tied to read-aloud because the avatar IS the voice: it is driven by the
  // coach's own speech audio, so with replies not being read out there is
  // nothing to drive it and no reason to pull ten megabytes of assets.
  const avatar = useAvatar({
    enabled: avatarOn,
    // Read-aloud off is passed in rather than folded into `enabled`, so the
    // hook can say "turn read-aloud on" instead of going quiet.
    voiced: speakOn,
    container: avatarContainerRef,
  });

  const speaker = useSpeaker({ enabled: speakOn, speaker: profile.voice, sink: avatar.sink });
  // Destructured because useSpeaker hands back a fresh object every render, so
  // anything depending on `speaker` itself is rebuilt on every render.
  const {
    cancel: cancelSpeech,
    reset: resetSpeech,
    feed: feedSpeech,
    flush: flushSpeech,
    supported: speakSupported,
    speaking: speakerSpeaking,
  } = speaker;

  // Whichever half is actually making the sound. Barge-in reads this, and it
  // has to be true for both or talking over the avatar wouldn't stop it.
  const coachSpeaking = speakerSpeaking || avatar.speaking;

  /**
   * The live page shows what the coach said only when it cannot say it. A coach
   * that speaks is listened to; a coach that can't has to be read, and hiding
   * its words then would leave a room where nothing happens.
   */
  const showTranscript = !(speakOn && speakSupported);

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

  /* -------------------------------- the voice ----------------------------- */

  /**
   * Auto-send changes what pulls the trigger, never what gets sent: it calls the
   * same send() the Send button does, with the same text. A rehearsal being set
   * up or debriefed counts as busy, because a turn arriving in the middle of
   * either has nowhere to go.
   */
  const voice = useVoiceLoop({
    micOn,
    autoSend,
    hasDraft: draft.trim().length > 0,
    busy: busy || stage === "starting" || stage === "debriefing",
    coachSpeaking,
    getDraft: () => draft,
    onDictated: (text) => setDraft((current) => joinSpoken(current, text)),
    onSend: (text) => send(text),
    onInterrupt: cancelSpeech,
  });

  /* ------------------------------ persistence ----------------------------- */

  const persist = useCallback((next: Session) => {
    const stamped = { ...next, title: titleFor(next), updatedAt: new Date().toISOString() };
    saveSession(stamped);
    setSession(stamped);
    return stamped;
  }, []);

  /**
   * The takeaways from one exchange, fetched once the coach has finished
   * saying it. After, never during: nothing may land on screen while the user
   * is still mid-answer, which is the same rule the debrief follows.
   *
   * Deliberately not awaited by the send path and deliberately silent on
   * failure. A cue that doesn't arrive costs the user nothing; a spinner or an
   * error where a piece of advice should be costs them the thread.
   */
  const collectCues = useCallback(
    async (base: Session) => {
      try {
        const res = await fetch("/api/cues", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: base.mode,
            messages: base.messages.map(({ role, content }) => ({ role, content })),
          }),
        });
        if (!res.ok) return;
        const payload = (await res.json()) as { cues?: string[] };
        const fresh = (payload.cues ?? []).filter(Boolean);
        if (fresh.length === 0) return;

        const current = sessionRef.current;
        // The thread has moved on (a new conversation, a reset). These cues
        // belong to a session that is no longer on screen.
        if (current.id !== base.id) return;

        const now = new Date().toISOString();
        const existing = current.cues ?? [];
        // The coach repeats itself across turns, and the same advice arriving
        // twice as two identical cards would make the list look broken.
        const seen = new Set(existing.map((c) => c.text.toLowerCase()));
        const added: CuePoint[] = fresh
          .filter((text) => !seen.has(text.toLowerCase()))
          .map((text) => ({ id: uid(), text, source: "advice" as const, createdAt: now }));
        if (added.length === 0) return;

        persist({ ...current, cues: [...existing, ...added] });
      } catch {
        // Offline, or the request was cut short. The conversation is unaffected.
      }
    },
    [persist]
  );

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
          const answered = persist({
            ...base,
            messages: [...base.messages, newMessage("assistant", received.trim())],
          });
          void collectCues(answered);
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
    [
      persist,
      profile.about,
      profile.goal,
      cancelSpeech,
      resetSpeech,
      feedSpeech,
      flushSpeech,
      collectCues,
    ]
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
    // Two readings of the same numbers: the rollup that informs the score, and
    // the fuller timeline the analysis pass reads for patterns. Both are text.
    const signalSummary = summariseSignals(raw, userLines);
    const signalDetail = detailSignals(raw, userLines);
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
          signalDetail,
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
      // The debrief's spoken cues join the same running list, so a rehearsal
      // leaves something on screen once the card has been scrolled past.
      const now = new Date().toISOString();
      const fromDebrief: CuePoint[] = (result.cues ?? []).map((text) => ({
        id: uid(),
        text,
        source: "debrief" as const,
        createdAt: now,
      }));
      persist({
        ...session,
        roleplay,
        debrief: result,
        cues: [...(session.cues ?? []), ...fromDebrief],
      });
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put the debrief together.");
      setStage("live");
    }
  }

  /* -------------------------------- actions ------------------------------- */

  /** The one send path. Auto-send, the Send button and Enter all land here. */
  function send(explicit?: string) {
    const text = (explicit ?? draft).trim();
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

  function toggleAvatar() {
    const next = !avatarOn;
    setAvatarOn(next);
    saveProfile({ ...profile, avatar: next });
  }

  function toggleAutoSend() {
    const next = !autoSend;
    setAutoSend(next);
    saveProfile({ ...profile, autoSend: next });
  }

  function startFresh(nextMode: ModeId = session.mode) {
    stop();
    voice.stop();
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

  /* ------------------------------ the debrief beat ------------------------- */

  /** One spoken debrief per rehearsal, whatever re-renders happen after it. */
  const spokenDebriefRef = useRef<string | null>(null);
  const cues = session.debrief?.cues;

  useEffect(() => {
    if (stage !== "done" || !cues?.length) return;
    if (spokenDebriefRef.current === session.id + session.debrief?.verdict) return;
    spokenDebriefRef.current = session.id + session.debrief?.verdict;
    if (!speakOn) return;
    // After the exchange, never during it. This is the one moment the coach is
    // allowed to say something about how it went, and it lands the way a friend
    // would say it rather than as a read-out of the card.
    resetSpeech();
    flushSpeech(`Okay. Here's what I noticed. ${cues.join(" ")}`);
  }, [stage, cues, session.id, session.debrief?.verdict, speakOn, resetSpeech, flushSpeech]);

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
          {showTranscript && (
            <>
              {scenario.opening && <MessageBubble role="assistant" content={scenario.opening} />}
              {roleplayTurns.map((t) => (
                <MessageBubble key={t.id} role={t.role} content={t.content} />
              ))}
            </>
          )}
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
      {/* One block, centred: the stage and the read underneath it share a width
          and sit together, rather than a tile adrift in a wide column with the
          cards stretched across the bottom of it. */}
      <div className="mx-auto flex w-full min-w-0 max-w-[34rem] flex-col justify-center gap-2.5 p-3 md:min-h-0 md:flex-1 md:p-4">
        <Stage
          avatarContainerRef={avatarContainerRef}
          avatarStatus={avatar.status}
          avatarFailure={avatar.failure}
          avatarOn={avatarOn}
          onToggleAvatar={toggleAvatar}
          onAvatarFail={avatar.reportCrash}
          coachSpeaking={coachSpeaking}
          presence={presence}
          videoRef={videoRef}
          cameraLive={captureStatus === "running"}
          read={read}
          nudgeLevel={nudgeLevel}
          cameraMessage={cameraMessage}
          practising={live}
          cameraOn={cameraOn}
          micOn={micOn}
          onToggleCamera={() => setCameraOn((v) => !v)}
          onToggleMic={() => setMicOn((v) => !v)}
          onEnd={endCall}
          endLabel={live ? "End practice" : "End"}
          endDisabled={!live && !cameraOn}
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
        showTranscript={showTranscript}
        cues={session.cues ?? []}
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        onStop={stop}
        voice={voice}
        autoSend={autoSend}
        onToggleAutoSend={toggleAutoSend}
        micOn={micOn}
        placeholder={live ? "Say your line…" : mode.composerPlaceholder}
        hint={
          live
            ? "Feedback comes after. Hit End practice when you're done."
            : micOn && autoSend
              ? "Tap the mic and just talk. It sends when you stop."
              : micOn
                ? "Tap the mic and just talk."
                : "Enter to send, Shift+Enter for a new line."
        }
        footnote={
          mode.disclaimer ??
          (showTranscript
            ? "Saved on this device only. No video ever leaves it."
            : "Your coach speaks rather than types. The whole conversation is in History.")
        }
      >
        {panelExtras}
      </CoachPanel>
    </div>
  );
}
