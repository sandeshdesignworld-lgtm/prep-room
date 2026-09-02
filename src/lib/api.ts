import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
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

/** Pipes an Anthropic text stream to the client as plain text. */
export function textStreamResponse(stream: MessageStream, request: Request, label: string) {
  request.signal.addEventListener("abort", () => stream.abort());

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        if (!request.signal.aborted) console.error(`[${label}] stream failed`, err);
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
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
