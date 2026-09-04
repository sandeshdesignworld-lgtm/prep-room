"use client";

import type { Role } from "@/lib/types";

/**
 * The coach writes plain prose with the occasional bullet and a quoted line to
 * actually say. We render exactly those three things, quoted lines get pulled
 * out because they're the part the user came for.
 */
function renderBody(content: string) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-blue" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();

    // A whole line in quotes is a script: words to say out loud.
    const quoted = line.match(/^["“](.+)["”][.]?$/);
    if (quoted) {
      blocks.push(
        <p
          key={`q-${blocks.length}`}
          className="my-2.5 border-l-2 border-blue bg-blue/8 py-2 pl-3 pr-2 text-[15px] italic"
        >
          &ldquo;{quoted[1]}&rdquo;
        </p>
      );
      continue;
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="my-2 first:mt-0 last:mb-0">
        {line}
      </p>
    );
  }
  flushBullets();
  return blocks;
}

export default function MessageBubble({
  role,
  content,
  pending,
}: {
  role: Role;
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
          isUser
            ? "bg-bubble-user text-bubble-user-ink rounded-br-md"
            : "bg-bubble-coach text-bubble-coach-ink rounded-bl-md",
        ].join(" ")}
      >
        {isUser ? <p className="whitespace-pre-wrap">{content}</p> : renderBody(content)}
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
