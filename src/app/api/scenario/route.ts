import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, describeError, MODEL } from "@/lib/anthropic";
import { scenarioSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { sanitiseTurns } from "@/lib/api";
import { isDifficulty } from "@/lib/scenario";
import { parseJsonLoose } from "@/lib/json";
import type { Scenario, ScenarioRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const ScenarioSchema = z.object({
  counterpart: z.string(),
  situation: z.string(),
  opening: z.string(),
});
type ScenarioDraft = z.infer<typeof ScenarioSchema>;

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
    const response = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 1000,
      system: scenarioSystemPrompt({ mode: body.mode, difficulty }),
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Set up the practice scenario for the situation we just discussed. Return only the scenario.",
        },
      ],
      output_config: { format: zodOutputFormat(ScenarioSchema) },
    });

    const draft = response.parsed_output ?? fallbackParse(response);
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
    const { status, message } = describeError(err);
    console.error("[/api/scenario]", err);
    return Response.json({ error: message }, { status });
  }
}

/** Structured outputs should make this unreachable; it's here so a hiccup isn't fatal. */
function fallbackParse(response: { content: Array<{ type: string }> }): ScenarioDraft | null {
  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = parseJsonLoose<unknown>(text);
  const result = ScenarioSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
