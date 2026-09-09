import type { Turn } from "./types";

const MAX_MESSAGES = 80;
const MAX_CHARS = 6000;

/**
 * Trims a client-supplied transcript to something safe to forward. Also drops
 * leading assistant turns, because the API rejects them and every thread here starts
 * with the user.
 */
export function sanitiseTurns(input: unknown): Turn[] {
  const turns = (Array.isArray(input) ? input : [])
    .filter(
      (m): m is Turn =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES);

  while (turns.length && turns[0].role === "assistant") turns.shift();
  return turns;
}

export function clampText(value: unknown, max = 1000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Pipes a text stream to the client as plain text.
 *
 * Provider-agnostic by the time it gets here: whoever answered, this sees an
 * async iterable of strings.
 *
 * The first chunk has already been pulled by streamText(), which is what makes
 * a failure before this point recoverable and a failure after it not. Once
 * bytes are on the wire the status is long since sent, so a mid-sentence
 * collapse can only be reported inside the body. It used to be swallowed
 * entirely: the stream closed early, the client saw a clean 200 with a short
 * reply, and nobody could tell a finished answer from a broken one. A truncated
 * reply now says it was truncated.
 */
export function textStreamResponse(
  stream: AsyncIterable<string>,
  request: Request,
  label: string,
) {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const text of stream) {
          if (request.signal.aborted) break;
          controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        if (!request.signal.aborted) {
          console.error(`[${label}] stream failed part-way through`, err);
          controller.enqueue(
            encoder.encode("\n\n[The coach was cut off mid-answer. Send that again.]"),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
