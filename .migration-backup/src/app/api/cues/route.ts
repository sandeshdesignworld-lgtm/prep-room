import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, describeError, MODEL } from "@/lib/anthropic";
import { cuesSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { sanitiseTurns } from "@/lib/api";
import { cleanLine, parseJsonLoose } from "@/lib/json";
import type { CuesRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const CuesSchema = z.object({
  cues: z.array(z.string()),
});

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
    const response = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 500,
      system: cuesSystemPrompt({ mode: body.mode }),
      messages: [
        {
          role: "user",
          content: `${transcript}\n\nWrite the cues from the coach's last reply.`,
        },
      ],
      output_config: { format: zodOutputFormat(CuesSchema) },
    });

    const parsed = response.parsed_output ?? fallbackParse(response);
    const cues = (parsed?.cues ?? []).map(cleanLine).filter(Boolean).slice(0, MAX_CUES);
    return Response.json({ cues }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error("[/api/cues]", err);
    return Response.json({ error: message }, { status });
  }
}

function fallbackParse(response: {
  content: Array<{ type: string }>;
}): z.infer<typeof CuesSchema> | null {
  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const result = CuesSchema.safeParse(parseJsonLoose<unknown>(text));
  return result.success ? result.data : null;
}
