import { describeFailure, streamText } from "@/lib/llm";
import "@/lib/providers";
import { roleplaySystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { sanitiseTurns, textStreamResponse } from "@/lib/api";
import { readScenario } from "@/lib/scenario";
import type { RoleplayRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: RoleplayRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!isModeId(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }

  const scenario = readScenario(body.scenario);
  if (!scenario) {
    return Response.json({ error: "This practice run is missing its setup." }, { status: 400 });
  }

  const messages = sanitiseTurns(body.messages);
  if (messages.length === 0) {
    return Response.json({ error: "Nothing to respond to." }, { status: 400 });
  }

  try {
    const { stream } = await streamText(
      {
        system: roleplaySystemPrompt({ mode: body.mode, scenario }),
        messages,
        // Spoken turns are short. A low ceiling also discourages monologuing.
        maxTokens: 400,
      },
      "/api/roleplay",
    );
    return textStreamResponse(stream, request, "/api/roleplay");
  } catch (err) {
    const { status, message } = describeFailure(err);
    console.error("[/api/roleplay]", err);
    return Response.json({ error: message }, { status });
  }
}
