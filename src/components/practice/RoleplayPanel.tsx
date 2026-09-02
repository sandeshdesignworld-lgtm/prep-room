"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Composer from "@/components/advisor/Composer";
import AmbientNudge from "./AmbientNudge";
import DebriefCard from "./DebriefCard";
import { DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_NOTE } from "@/lib/scenario";
import { getMode } from "@/lib/modes";
import { useSpeaker } from "@/lib/speech";
import { CAPTURE_MESSAGE, downsample, summariseSignals, useSignalCapture } from "@/lib/signals";
import { newMessage, saveProfile } from "@/lib/storage";
import type {
  Debrief,
  SignalSample,
  Difficulty,
  Message,
  ModeId,
  Profile,
  Roleplay,
  Scenario,
  Turn,
} from "@/lib/types";

type Stage = "setup" | "starting" | "live" | "debriefing" | "done";

export default function RoleplayPanel({
  profile,
  mode,
  advisorTurns,
  onFinish,
  onClose,
}: {
  profile: Profile;
  mode: ModeId;
  advisorTurns: Turn[];
  onFinish: (roleplay: Roleplay, debrief: Debrief) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("setup");
  const [difficulty, setDifficulty] = useState<Difficulty>("realistic");
  const [nudge, setNudge] = useState(profile.ambientNudge);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [turns, setTurns] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [useCamera, setUseCamera] = useState(false);
  const [signals, setSignals] = useState<SignalSample[]>([]);
  const startedAtRef = useRef<string>(new Date().toISOString());

  // Practice is meant to happen out loud, so the counterpart speaks whenever
  // read-aloud is on.
  const speaker = useSpeaker({ enabled: profile.speakReplies, speaker: profile.voice });
  const capture = useSignalCapture();

  // The dot only ever appears when the camera is actually producing signals
  // AND the user asked for it. Anything else would be a fabricated cue.
  const nudgeLevel = nudge && capture.status === "running" ? capture.level : null;

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streamText, stage]);

  useEffect(() => () => speaker.cancel(), [speaker]);

  const counterpartReply = useCallback(
    async (activeScenario: Scenario, history: Message[]) => {
      setBusy(true);
      setStreamText("");
      setError(null);
      speaker.cancel();
      speaker.reset();

      let received = "";
      try {
        const res = await fetch("/api/roleplay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            scenario: activeScenario,
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
          speaker.feed(received);
        }
        received += decoder.decode();
        speaker.flush(received);

        if (received.trim()) {
          setTurns((prev) => [...prev, newMessage("assistant", received.trim())]);
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
    [mode, speaker]
  );

  async function start() {
    setStage("starting");
    setError(null);
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, difficulty, messages: advisorTurns }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "Couldn't set this up. Try again.");

      const next = payload as Scenario;
      setScenario(next);
      startedAtRef.current = new Date().toISOString();
      setStage("live");
      if (useCamera) void capture.start();
      if (next.opening && profile.speakReplies) {
        speaker.reset();
        speaker.flush(next.opening);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set this up. Try again.");
      setStage("setup");
    }
  }

  function send() {
    const text = draft.trim();
    if (!text || busy || !scenario) return;
    setDraft("");
    const next = [...turns, newMessage("user", text)];
    // Index among the user's own turns, which is what the debrief counts.
    capture.markTurn(next.filter((t) => t.role === "user").length - 1);
    setTurns(next);
    void counterpartReply(scenario, next);
  }

  async function end() {
    if (!scenario) return;
    speaker.cancel();
    setStage("debriefing");
    setError(null);

    // Raw ~10Hz samples never leave this function; only the rollup text goes to
    // the server, and only a 1Hz version is kept for the chart.
    const raw = capture.stop();
    const userLines = turns.filter((t) => t.role === "user").map((t) => t.content);
    const signalSummary = summariseSignals(raw, userLines);
    const kept = downsample(raw);
    setSignals(kept);

    try {
      const res = await fetch("/api/debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          scenario,
          messages: turns.map(({ role, content }) => ({ role, content })),
          signalSummary,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "Couldn't put the debrief together.");

      const result = payload as Debrief;
      setDebrief(result);
      setStage("done");
      onFinish(
        {
          scenario,
          messages: turns,
          startedAt: startedAtRef.current,
          endedAt: new Date().toISOString(),
          signals: kept,
        },
        result
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put the debrief together.");
      setStage("live");
    }
  }

  const modeConfig = getMode(mode);

  const body = (
    <div className="relative">
      <AmbientNudge level={nudgeLevel} />

      {/*
        Always mounted, never conditional: start() reads this ref as soon as the
        user hits Start, and a ref that only exists after the next render would
        be null exactly then. Muted and playsInline so mobile browsers allow it.
      */}
      <video
        ref={capture.videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden
        className={
          capture.status === "running"
            ? "absolute right-0 top-0 h-20 w-28 -scale-x-100 rounded-xl border object-cover hairline"
            : "pointer-events-none absolute h-0 w-0 opacity-0"
        }
      />

      {stage === "setup" && (
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-semibold text-ink">Practise it out loud</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              I&apos;ll play {modeConfig.counterpart} and stay in character. No coaching while
              we&apos;re in it, that comes after, when you&apos;re done.
            </p>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
              How hard should they be?
            </legend>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  aria-pressed={difficulty === d}
                  className={[
                    "rounded-xl border p-2.5 text-left transition-colors",
                    difficulty === d ? "border-dusty bg-dusty/10" : "bg-card hairline hover:bg-fill-2",
                  ].join(" ")}
                >
                  <span className="block text-sm font-medium text-ink">{DIFFICULTY_LABEL[d]}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-2">
                    {DIFFICULTY_NOTE[d]}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-3 rounded-xl border bg-card hairline p-3">
            <input
              type="checkbox"
              checked={useCamera}
              onChange={(e) => setUseCamera(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--dusty)]"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                Watch how I come across
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">
                Your camera, read entirely inside your browser. No video is recorded, uploaded, or
                sent anywhere, what&apos;s kept is a handful of numbers: where your head was
                pointing, how much you moved, how square your shoulders were. You&apos;ll see them
                in the debrief, never during.
              </span>
            </span>
          </label>

          <label
            className={[
              "flex items-start gap-3 rounded-xl border p-3 transition-opacity",
              useCamera ? "bg-card hairline" : "bg-card hairline opacity-55",
            ].join(" ")}
          >
            <input
              type="checkbox"
              checked={nudge}
              disabled={!useCamera}
              onChange={(e) => {
                // Persisted, not per-run: the point is to compare sessions with
                // it on against sessions with it off.
                setNudge(e.target.checked);
                saveProfile({ ...profile, ambientNudge: e.target.checked });
              }}
              className="mt-0.5 h-4 w-4 accent-[var(--dusty)]"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Gentle nudge while we talk</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">
                {useCamera
                  ? "A soft dot in the corner that drifts colour if you drift, never words, never a voice, never mid-sentence. Try a session each way and see which suits you."
                  : "Turn the camera on above to use this."}
              </span>
            </span>
          </label>

          {error && <p className="text-sm text-brick">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={start}
              className="rounded-xl bg-poppy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-poppy-hover"
            >
              Start practice
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {stage === "starting" && (
        <p className="py-6 text-center text-sm text-ink-2">Setting the scene…</p>
      )}

      {(stage === "live" || stage === "debriefing" || stage === "done") && scenario && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs leading-relaxed text-ink-2">
              You&apos;re talking to{" "}
              <span className="font-medium text-ink">{scenario.counterpart}</span> ·{" "}
              {DIFFICULTY_LABEL[scenario.difficulty]}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setFullscreen((v) => !v)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
              >
                {fullscreen ? "Exit full screen" : "Full screen"}
              </button>
              {stage === "live" && (
                <button
                  type="button"
                  onClick={end}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
                >
                  End practice
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {scenario.opening && (
              <Line role="assistant" content={scenario.opening} />
            )}
            {turns.map((t) => (
              <Line key={t.id} role={t.role} content={t.content} />
            ))}
            {busy && <Line role="assistant" content={streamText} pending />}
            <div ref={bottomRef} />
          </div>

          {stage === "live" && useCamera && capture.status !== "running" && (
            <p className="text-xs text-ink-2">
              {CAPTURE_MESSAGE[capture.status as keyof typeof CAPTURE_MESSAGE] ?? ""}
            </p>
          )}

          {error && stage !== "done" && <p className="text-sm text-brick">{error}</p>}

          {stage === "live" && (
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={send}
              onStop={() => undefined}
              onDictationStart={speaker.cancel}
              busy={busy}
              placeholder="Say your line…"
              hint={
                turns.length === 0
                  ? "Answer them the way you actually would."
                  : "Feedback comes after. Tap End practice."
              }
            />
          )}

          {stage === "debriefing" && (
            <p className="py-4 text-center text-sm text-ink-2">Looking back over that…</p>
          )}

          {stage === "done" && debrief && (
            <div className="space-y-3">
              <DebriefCard debrief={debrief} scenario={scenario} signals={signals} />
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-poppy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-poppy-hover"
              >
                Back to the coach
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-page">
        <div className="mx-auto w-full max-w-2xl px-5 py-6">{body}</div>
      </div>
    );
  }

  return <div className="rounded-2xl border bg-fill-2 hairline p-4">{body}</div>;
}

function Line({
  role,
  content,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed",
          isUser
            ? "bg-bubble-user text-bubble-user-ink rounded-br-md"
            : "bg-card text-ink rounded-bl-md border hairline",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap">{content}</p>
        {pending && (
          <span
            aria-label="Thinking"
            className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-ink-3"
          />
        )}
      </div>
    </div>
  );
}
