"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import { MODES, MODE_ORDER } from "@/lib/modes";
import { useSpeechSupport } from "@/lib/speech";
import { CONSENT_VERSION } from "@/lib/storage";
import type { InputPreference, ModeId, Profile } from "@/lib/types";

const ACCENT_RING: Record<string, string> = {
  coral: "border-coral bg-coral/8",
  blue: "border-blue bg-blue/12",
  amber: "border-amber bg-amber/20",
};

const ACCENT_DOT: Record<string, string> = {
  coral: "bg-coral",
  blue: "bg-blue",
  amber: "bg-amber",
};

export default function Setup({ onDone }: { onDone: (profile: Profile) => void }) {
  const [mode, setMode] = useState<ModeId>("general");
  const [about, setAbout] = useState("");
  const [goal, setGoal] = useState("");
  const [inputPreference, setInputPreference] = useState<InputPreference>("typing");
  const support = useSpeechSupport();

  function submit() {
    const now = new Date().toISOString();
    onDone({
      mode,
      about: about.trim(),
      goal: goal.trim(),
      inputPreference,
      speakReplies: inputPreference === "voice" && support.speaking,
      // Phase 3/4. Off by default, on purpose: the point is to compare.
      ambientNudge: false,
      consentedAt: now,
      consentVersion: CONSENT_VERSION,
      createdAt: now,
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-5 py-12">
      <div className="fade-up">
        <h1 className="text-2xl font-semibold text-ink">Let&apos;s set you up</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          You can change any of this later, and switch between these any time.
        </p>

        <div className="mt-7 space-y-6">
          <fieldset>
            <legend className="text-sm font-medium text-ink">
              What do you want to work on first?
            </legend>
            <div className="mt-3 space-y-2.5">
              {MODE_ORDER.map((id) => {
                const m = MODES[id];
                const selected = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    aria-pressed={selected}
                    className={[
                      "block w-full rounded-2xl border p-4 text-left transition-colors",
                      selected ? ACCENT_RING[m.accent] : "bg-card hairline hover:bg-fill-2",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className={[
                          "h-2 w-2 shrink-0 rounded-full",
                          selected ? ACCENT_DOT[m.accent] : "bg-line",
                        ].join(" ")}
                      />
                      <span className="text-sm font-semibold text-ink">{m.label}</span>
                      <span className="text-xs text-ink-3">{m.tagline}</span>
                    </span>
                    <span className="mt-1.5 block pl-[18px] text-sm leading-relaxed text-ink-2">
                      {m.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field
            label="A bit about you"
            hint="Year, branch, what you're preparing for, whatever helps the advice land."
            optional
          >
            <textarea
              rows={3}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              className={inputClass}
              placeholder="Final year CSE, campus placements starting next month, no internship yet."
            />
          </Field>

          <Field label="What would make this worth it?" optional>
            <textarea
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className={inputClass}
              placeholder="Stop blanking in the first two minutes of an interview."
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium text-ink">
              Do you want to talk, or type?
            </legend>
            <p className="mt-0.5 text-xs text-ink-2">
              Both work everywhere, this is just what we open with.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {(
                [
                  { id: "typing", label: "Type", note: "Quieter, easier to edit" },
                  { id: "voice", label: "Talk", note: "Closer to the real thing" },
                ] as const
              ).map((opt) => {
                const selected = inputPreference === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setInputPreference(opt.id)}
                    aria-pressed={selected}
                    className={[
                      "rounded-2xl border p-3.5 text-left transition-colors",
                      selected ? "border-blue bg-blue/10" : "bg-card hairline hover:bg-fill-2",
                    ].join(" ")}
                  >
                    <span className="block text-sm font-medium text-ink">{opt.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-2">{opt.note}</span>
                  </button>
                );
              })}
            </div>
            {inputPreference === "voice" && (
              <p className="mt-2 text-xs leading-relaxed text-ink-2">
                {support.dictation
                  ? "We'll put a mic in the message box, and read replies back to you. Your browser does the transcribing, on most browsers that means the audio goes to the browser maker, not to us."
                  : "This browser doesn't support speech-to-text, though Chrome and Edge do. You'll be typing for now, and the mic will appear on its own if you switch browsers."}
              </p>
            )}
          </fieldset>
        </div>

        <div className="mt-8">
          <Button full onClick={submit}>
            Start
          </Button>
        </div>
      </div>
    </div>
  );
}
