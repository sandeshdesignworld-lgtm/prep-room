import { z } from "zod";
import { describeFailure, parseJson } from "@/lib/llm";
import "@/lib/providers";
import { cuesSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { sanitiseTurns } from "@/lib/api";
import { cleanLine } from "@/lib/json";
import type { CuesRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const CuesSchema = z.object({
  cues: z.array(z.string()),
});

/** Described in words for providers that cannot be handed the schema itself. */
const CUES_HINT = '{ "cues": ["short string", ...] }';

/** Three is a glanceable list; more per exchange is a wall by the third turn. */
const MAX_CUES = 3;

export async function POST(request: Request) {
  let body: CuesRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!isModeId(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }

  const messages = sanitiseTurns(body.messages);
  // Nothing has been said, or the coach hasn't answered yet. Either way there
  // is nothing to take away, and an empty list is a correct answer here.
  if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") {
    return Response.json({ cues: [] }, { headers: { "cache-control": "no-store" } });
  }

  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "COACH" : "USER"}: ${m.content}`)
    .join("\n\n");

  try {
    const parsed = await parseJson(
      {
        system: cuesSystemPrompt({ mode: body.mode }),
        messages: [
          {
            role: "user",
            content: `${transcript}\n\nWrite the cues from the coach's last reply.`,
          },
        ],
        maxTokens: 500,
      },
      CuesSchema,
      CUES_HINT,
      "/api/cues",
    );
    const cues = (parsed?.cues ?? []).map(cleanLine).filter(Boolean).slice(0, MAX_CUES);
    return Response.json({ cues }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const { status, message } = describeFailure(err);
    console.error("[/api/cues]", err);
    return Response.json({ error: message }, { status });
  }
}
