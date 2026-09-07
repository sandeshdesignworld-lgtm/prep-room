"use client";

import SignalTimeline from "./SignalTimeline";
import type { Debrief, Scenario, SignalSample } from "@/lib/types";

function List({
  title,
  items,
  dot,
}: {
  title: string;
  items: string[];
  dot: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">{title}</h4>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
            <span aria-hidden className={`mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 text-blue" fill="none" strokeWidth={1.8}>
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

export default function DebriefCard({
  debrief,
  scenario,
  signals,
}: {
  debrief: Debrief;
  scenario?: Scenario;
  signals?: SignalSample[];
}) {
  // `delivery` is what debriefs written before the analysis pass stored. Old
  // saved sessions still open, they just get the flatter notes they were given.
  const noticed = debrief.noticed ?? debrief.delivery ?? [];
  const cues = debrief.cues ?? [];

  return (
    <div className="rounded-2xl border bg-card hairline p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-blue-strong">Debrief</p>
          <h3 className="mt-1 text-lg leading-tight font-semibold text-ink">{debrief.verdict}</h3>
          {scenario && (
            <p className="mt-1 text-xs text-ink-2">You practised against {scenario.counterpart}.</p>
          )}
        </div>
        <div className="flex shrink-0 items-baseline gap-1 rounded-xl bg-amber px-3 py-1.5">
          <span className="text-xl font-semibold text-on-amber">{debrief.score}</span>
          <span className="text-xs text-on-amber/75">/10</span>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <List title="What worked" items={debrief.strengths} dot="bg-blue" />
        <List title="What to sharpen" items={debrief.improvements} dot="bg-coral" />

        {debrief.stronger_line.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
              A stronger way to handle it
            </h4>
            <div className="mt-2 space-y-2">
              {debrief.stronger_line.map((line, i) => (
                <p
                  key={i}
                  className="border-l-2 border-blue bg-blue/8 py-2 pl-3 pr-2 text-sm leading-relaxed text-ink"
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}

        {noticed.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
              What I noticed
            </h4>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              Estimated from your camera, on this device. Where your head and shoulders were
              pointing and how much you moved, not how you felt.
            </p>
            <ul className="mt-2 space-y-2">
              {noticed.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                  <span aria-hidden className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cues.length > 0 && (
          <div className="rounded-xl bg-fill-2 px-3.5 py-3">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
              <SpeakerIcon />
              Cues for next time
            </h4>
            <ul className="mt-2 space-y-1.5">
              {cues.map((cue, i) => (
                <li key={i} className="text-sm leading-relaxed text-ink">
                  &ldquo;{cue}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        )}

        {signals && signals.length > 1 && (
          <div className="border-t border-line/60 pt-4">
            <SignalTimeline samples={signals} />
          </div>
        )}
      </div>
    </div>
  );
}
