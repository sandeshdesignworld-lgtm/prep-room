import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, describeError, MODEL } from "@/lib/anthropic";
import { debriefSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { clampText, sanitiseTurns } from "@/lib/api";
import { readScenario } from "@/lib/scenario";
import { parseJsonLoose } from "@/lib/json";
import type { Debrief, DebriefRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const DebriefSchema = z.object({
  score: z.number().int().min(1).max(10),
  verdict: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  stronger_line: z.array(z.string()),
  delivery: z.array(z.string()),
});

export async function POST(request: Request) {
  let body: DebriefRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!isModeId(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }

  const scenario = readScenario(body.scenario);
  const messages = sanitiseTurns(body.messages);
  if (messages.length === 0) {
    return Response.json({ error: "There's nothing to look back on yet." }, { status: 400 });
  }

  const signalSummary = clampText(body.signalSummary, 4000);

  const transcript = [
    scenario
      ? `The user was practising against: ${scenario.counterpart}.${
          scenario.situation ? ` Situation: ${scenario.situation}` : ""
        }`
      : "",
    "",
    "Transcript. THEM is the counterpart, ME is the user you are coaching:",
    // The counterpart's opening lives in the scenario, not the message list,
    // because the API requires the first message to be the user's.
    scenario?.opening ? `THEM: ${scenario.opening}` : "",
    ...messages.map((m) => `${m.role === "assistant" ? "THEM" : "ME"}: ${m.content}`),
    signalSummary ? `\nDelivery-signal summary:\n${signalSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: debriefSystemPrompt({ mode: body.mode, hasSignals: signalSummary.length > 0 }),
      messages: [{ role: "user", content: transcript }],
      output_config: { format: zodOutputFormat(DebriefSchema) },
    });

    const parsed = response.parsed_output ?? fallbackParse(response);
    if (!parsed) {
      return Response.json({ error: "Couldn't put the debrief together. Try again." }, { status: 502 });
    }

    // Trim to the shape the UI lays out, and drop delivery claims we can't back up.
    const debrief: Debrief = {
      score: Math.min(10, Math.max(1, Math.round(parsed.score))),
      verdict: parsed.verdict.trim(),
      strengths: parsed.strengths.slice(0, 3),
      improvements: parsed.improvements.slice(0, 3),
      stronger_line: parsed.stronger_line.slice(0, 4),
      delivery: signalSummary ? parsed.delivery.slice(0, 4) : [],
    };
    return Response.json(debrief, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error("[/api/debrief]", err);
    return Response.json({ error: message }, { status });
  }
}

function fallbackParse(response: { content: Array<{ type: string }> }): z.infer<typeof DebriefSchema> | null {
  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const result = DebriefSchema.safeParse(parseJsonLoose<unknown>(text));
  return result.success ? result.data : null;
}
