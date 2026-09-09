import { describeFailure, streamText } from "@/lib/llm";
import "@/lib/providers";
import { advisorSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { clampText, sanitiseTurns, textStreamResponse } from "@/lib/api";
import type { AdvisorRequest } from "@/lib/types";

/** Conversation, not a cached document, so always run at request time. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: AdvisorRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!isModeId(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }

  const messages = sanitiseTurns(body.messages);
  if (messages.length === 0) {
    return Response.json({ error: "Nothing to respond to." }, { status: 400 });
  }

  try {
    const { stream } = await streamText(
      {
        system: advisorSystemPrompt({
          mode: body.mode,
          about: clampText(body.about),
          goal: clampText(body.goal),
        }),
        messages,
        maxTokens: 2000,
      },
      "/api/advisor",
    );
    return textStreamResponse(stream, request, "/api/advisor");
  } catch (err) {
    const { status, message } = describeFailure(err);
    console.error("[/api/advisor]", err);
    return Response.json({ error: message }, { status });
  }
}
