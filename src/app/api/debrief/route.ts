import { z } from "zod";
import { describeFailure, parseJson } from "@/lib/llm";
import "@/lib/providers";
import { debriefSystemPrompt, deliveryAnalysisSystemPrompt } from "@/lib/prompts";
import { isModeId } from "@/lib/modes";
import { clampText, sanitiseTurns } from "@/lib/api";
import { readScenario } from "@/lib/scenario";
import { cleanLine } from "@/lib/json";
import type { Debrief, DebriefRequest, ModeId } from "@/lib/types";

export const dynamic = "force-dynamic";

const DebriefSchema = z.object({
  score: z.number().int().min(1).max(10),
  verdict: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  stronger_line: z.array(z.string()),
});

const AnalysisSchema = z.object({
  noticed: z.array(z.string()),
  cues: z.array(z.string()),
});

type Analysis = z.infer<typeof AnalysisSchema>;

const NO_ANALYSIS: Analysis = { noticed: [], cues: [] };

/** Described in words for providers that cannot be handed the schema itself. */
const DEBRIEF_HINT =
  '{ "score": 1-10 integer, "verdict": "2-4 words", "strengths": ["..."], "improvements": ["..."], "stronger_line": ["..."] }';
const ANALYSIS_HINT = '{ "noticed": ["..."], "cues": ["..."] }';

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
  const signalDetail = clampText(body.signalDetail, 14000);

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
  ]
    .filter(Boolean)
    .join("\n");

  try {
    // Two passes, concurrently. They are separate because a single call asked
    // to score the conversation AND read the timeline does the second one
    // badly: it skims and hands back the per-turn averages, which the user has
    // already seen live. Concurrent because the debrief is the end of a
    // practice run and the user is sitting there waiting for it, so this costs
    // one call's latency rather than two.
    const [parsed, analysis] = await Promise.all([
      writeDebrief({
        mode: body.mode,
        transcript,
        signalSummary,
      }),
      signalDetail || signalSummary
        ? analyseDelivery({
            mode: body.mode,
            transcript,
            detail: signalDetail || signalSummary,
          })
        : Promise.resolve(NO_ANALYSIS),
    ]);

    if (!parsed) {
      return Response.json(
        { error: "Couldn't put the debrief together. Try again." },
        { status: 502 }
      );
    }

    // Trim to the shape the UI lays out, and drop delivery claims we can't back up.
    const lines = (items: string[], max: number) =>
      items.map(cleanLine).filter(Boolean).slice(0, max);

    const debrief: Debrief = {
      score: Math.min(10, Math.max(1, Math.round(parsed.score))),
      verdict: cleanLine(parsed.verdict),
      strengths: lines(parsed.strengths, 3),
      improvements: lines(parsed.improvements, 3),
      stronger_line: lines(parsed.stronger_line, 4),
      noticed: lines(analysis.noticed, 4),
      cues: lines(analysis.cues, 3),
    };
    return Response.json(debrief, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const { status, message } = describeFailure(err);
    console.error("[/api/debrief]", err);
    return Response.json({ error: message }, { status });
  }
}

async function writeDebrief(opts: {
  mode: ModeId;
  transcript: string;
  signalSummary: string;
}): Promise<z.infer<typeof DebriefSchema> | null> {
  const content = opts.signalSummary
    ? `${opts.transcript}\n\nDelivery-signal summary:\n${opts.signalSummary}`
    : opts.transcript;

  return parseJson(
    {
      system: debriefSystemPrompt({
        mode: opts.mode,
        hasSignals: opts.signalSummary.length > 0,
      }),
      messages: [{ role: "user", content }],
      maxTokens: 2000,
    },
    DebriefSchema,
    DEBRIEF_HINT,
    "/api/debrief",
  );
}

/**
 * Reads the timeline against the transcript. Failing here must not cost the
 * user their debrief, which is the thing they actually waited for, so this
 * swallows its own errors and hands back nothing to say.
 */
async function analyseDelivery(opts: {
  mode: ModeId;
  transcript: string;
  detail: string;
}): Promise<Analysis> {
  try {
    const parsed = await parseJson(
      {
        system: deliveryAnalysisSystemPrompt({ mode: opts.mode }),
        messages: [{ role: "user", content: `${opts.transcript}\n\n${opts.detail}` }],
        maxTokens: 2000,
      },
      AnalysisSchema,
      ANALYSIS_HINT,
      "/api/debrief delivery",
    );
    return parsed ?? NO_ANALYSIS;
  } catch (err) {
    console.error("[/api/debrief] delivery analysis failed", err);
    return NO_ANALYSIS;
  }
}
