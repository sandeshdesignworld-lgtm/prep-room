"use client";

import MessageBubble from "@/components/advisor/MessageBubble";
import DebriefCard from "@/components/practice/DebriefCard";
import { MODES } from "@/lib/modes";
import type { Session } from "@/lib/types";

/**
 * A whole session, read back.
 *
 * The live room deliberately shows none of this: the coach speaks and you
 * answer, and reading along a beat ahead of hearing it was what made the room
 * feel like a chat window. Nothing was dropped to achieve that, though, and
 * this is where the difference is settled. Everything that was said, in order,
 * including the rehearsal and the debrief.
 */
export default function SessionTranscript({ session }: { session: Session }) {
  const mode = MODES[session.mode];
  const roleplay = session.roleplay;

  return (
    <div className="space-y-3 border-t border-line/60 px-4 py-4">
      <MessageBubble role="assistant" content={mode.opener} />
      {session.messages.map((m) => (
        <MessageBubble key={m.id} role={m.role} content={m.content} />
      ))}

      {roleplay && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
              Practice · {roleplay.scenario.counterpart}
            </span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </div>
          {roleplay.scenario.opening && (
            <MessageBubble role="assistant" content={roleplay.scenario.opening} />
          )}
          {roleplay.messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} />
          ))}
        </div>
      )}

      {(session.cues?.length ?? 0) > 0 && (
        <div className="rounded-xl border bg-fill-2 hairline px-3.5 py-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2">
            Cue points from this session
          </h4>
          <ul className="mt-2 space-y-1.5">
            {session.cues?.map((cue) => (
              <li key={cue.id} className="text-sm leading-relaxed text-ink">
                {cue.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {session.debrief && (
        <DebriefCard
          debrief={session.debrief}
          scenario={roleplay?.scenario}
          signals={roleplay?.signals}
        />
      )}

      {session.messages.length === 0 && !roleplay && (
        <p className="text-sm text-ink-2">Nothing was said in this one.</p>
      )}
    </div>
  );
}
