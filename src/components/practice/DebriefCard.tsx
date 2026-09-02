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

export default function DebriefCard({
  debrief,
  scenario,
  signals,
}: {
  debrief: Debrief;
  scenario?: Scenario;
  signals?: SignalSample[];
}) {
  return (
    <div className="rounded-2xl border bg-card hairline p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-dusty">Debrief</p>
          <h3 className="mt-1 text-lg leading-tight font-semibold text-ink">{debrief.verdict}</h3>
          {scenario && (
            <p className="mt-1 text-xs text-ink-2">You practised against {scenario.counterpart}.</p>
          )}
        </div>
        <div className="flex shrink-0 items-baseline gap-1 rounded-xl bg-sun px-3 py-1.5">
          <span className="text-xl font-semibold text-on-sun">{debrief.score}</span>
          <span className="text-xs text-on-sun/75">/10</span>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <List title="What worked" items={debrief.strengths} dot="bg-sage" />
        <List title="What to sharpen" items={debrief.improvements} dot="bg-poppy" />

        {debrief.stronger_line.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
              A stronger way to handle it
            </h4>
            <div className="mt-2 space-y-2">
              {debrief.stronger_line.map((line, i) => (
                <p
                  key={i}
                  className="border-l-2 border-dusty bg-dusty/8 py-2 pl-3 pr-2 text-sm leading-relaxed text-ink"
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}

        <List title="Delivery" items={debrief.delivery} dot="bg-dusty" />

        {signals && signals.length > 1 && (
          <div className="border-t border-line/60 pt-4">
            <SignalTimeline samples={signals} />
          </div>
        )}
      </div>
    </div>
  );
}
