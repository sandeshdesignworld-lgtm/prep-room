import { z } from "zod";
import { describeFailure, parseJson } from "@/lib/llm";
import "@/lib/providers";
import { scenarioSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { sanitiseTurns } from "@/lib/api";
import { isDifficulty } from "@/lib/scenario";
import type { Scenario, ScenarioRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const ScenarioSchema = z.object({
  counterpart: z.string(),
  situation: z.string(),
  opening: z.string(),
});
/** Described in words for providers that cannot be handed the schema itself. */
const SCENARIO_HINT =
  '{ "counterpart": "who the coach plays", "situation": "one or two sentences", "opening": "their first line" }';

export async function POST(request: Request) {
  let body: ScenarioRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!isModeId(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }

  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : "realistic";
  const messages = sanitiseTurns(body.messages);
  if (messages.length === 0) {
    return Response.json({ error: "There's no conversation to practise yet." }, { status: 400 });
  }

  try {
    const draft = await parseJson(
      {
        system: scenarioSystemPrompt({ mode: body.mode, difficulty }),
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Set up the practice scenario for the situation we just discussed. Return only the scenario.",
          },
        ],
        maxTokens: 1000,
      },
      ScenarioSchema,
      SCENARIO_HINT,
      "/api/scenario",
    );
    if (!draft?.counterpart?.trim()) {
      return Response.json({ error: "Couldn't set up the practice run. Try again." }, { status: 502 });
    }

    const scenario: Scenario = {
      counterpart: draft.counterpart.trim(),
      situation: draft.situation?.trim() ?? "",
      opening: draft.opening?.trim() ?? "",
      difficulty,
    };
    return Response.json(scenario, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const { status, message } = describeFailure(err);
    console.error("[/api/scenario]", err);
    return Response.json({ error: message }, { status });
  }
}
