import { Router, type IRouter } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, describeError, MODEL } from "../lib/anthropic";
import { clampText, pipeTextStream, sanitiseTurns } from "../lib/api";
import { cleanLine, parseJsonLoose } from "../lib/json";
import { isModeId } from "../lib/modes";
import { advisorSystemPrompt, cuesSystemPrompt, debriefSystemPrompt, deliveryAnalysisSystemPrompt, roleplaySystemPrompt, scenarioSystemPrompt } from "../lib/prompts";
import { isDifficulty, readScenario } from "../lib/scenario";
import { CONTENT_TYPE, DEFAULT_SPEAKER, sarvamConfigured, speak } from "../lib/sarvam";
import { missingSpatiusVars, sessionToken, spatiusConfig } from "../lib/spatius";
import type { ModeId } from "../lib/types";
import { isSpeaker } from "../lib/voices";

const router: IRouter = Router();
const CuesSchema = z.object({ cues: z.array(z.string()) });
const ScenarioSchema = z.object({ counterpart: z.string(), situation: z.string(), opening: z.string() });
const DebriefSchema = z.object({ score: z.number().int().min(1).max(10), verdict: z.string(), strengths: z.array(z.string()), improvements: z.array(z.string()), stronger_line: z.array(z.string()) });
const AnalysisSchema = z.object({ noticed: z.array(z.string()), cues: z.array(z.string()) });
function fallback<T extends z.ZodType>(response: { content: Array<{ type: string }> }, schema: T): z.infer<T> | null { const text = response.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map(b => b.text).join(""); const output = schema.safeParse(parseJsonLoose<unknown>(text)); return output.success ? output.data : null; }
function error(req: any, res: any, path: string, err: unknown) { const detail = describeError(err); req.log.error({ err, path }, "Provider request failed"); res.status(detail.status).json({ error: detail.message }); }

router.post("/advisor", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Malformed request." }); return; }
  if (!isModeId(body.mode)) { res.status(400).json({ error: "Unknown mode." }); return; }
  const messages = sanitiseTurns(body.messages); if (!messages.length) { res.status(400).json({ error: "Nothing to respond to." }); return; }
  try { await pipeTextStream(anthropic().messages.stream({ model: MODEL, max_tokens: 2000, system: advisorSystemPrompt({ mode: body.mode, about: clampText(body.about), goal: clampText(body.goal) }), messages }), req, res, "/api/advisor"); } catch (err) { error(req, res, "/api/advisor", err); }
});
router.post("/roleplay", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Malformed request." }); return; }
  if (!isModeId(body.mode)) { res.status(400).json({ error: "Unknown mode." }); return; }
  const scenario = readScenario(body.scenario); if (!scenario) { res.status(400).json({ error: "This practice run is missing its setup." }); return; }
  const messages = sanitiseTurns(body.messages); if (!messages.length) { res.status(400).json({ error: "Nothing to respond to." }); return; }
  try { await pipeTextStream(anthropic().messages.stream({ model: MODEL, max_tokens: 400, system: roleplaySystemPrompt({ mode: body.mode, scenario }), messages }), req, res, "/api/roleplay"); } catch (err) { error(req, res, "/api/roleplay", err); }
});
router.post("/cues", async (req, res): Promise<void> => {
  const body = req.body; if (!body || typeof body !== "object") { res.status(400).json({ error: "Malformed request." }); return; }
  if (!isModeId(body.mode)) { res.status(400).json({ error: "Unknown mode." }); return; }
  const messages = sanitiseTurns(body.messages); if (!messages.length || messages.at(-1)?.role !== "assistant") { res.set("cache-control", "no-store").json({ cues: [] }); return; }
  try { const transcript = messages.map(m => `${m.role === "assistant" ? "COACH" : "USER"}: ${m.content}`).join("\n\n"); const response = await anthropic().messages.parse({ model: MODEL, max_tokens: 500, system: cuesSystemPrompt({ mode: body.mode }), messages: [{ role: "user", content: `${transcript}\n\nWrite the cues from the coach's last reply.` }], output_config: { format: zodOutputFormat(CuesSchema) } }); const parsed = response.parsed_output ?? fallback(response, CuesSchema); res.set("cache-control", "no-store").json({ cues: (parsed?.cues ?? []).map(cleanLine).filter(Boolean).slice(0, 3) }); } catch (err) { error(req, res, "/api/cues", err); }
});
router.post("/scenario", async (req, res): Promise<void> => {
  const body = req.body; if (!body || typeof body !== "object") { res.status(400).json({ error: "Malformed request." }); return; }
  if (!isModeId(body.mode)) { res.status(400).json({ error: "Unknown mode." }); return; }
  const difficulty = isDifficulty(body.difficulty) ? body.difficulty : "realistic", messages = sanitiseTurns(body.messages); if (!messages.length) { res.status(400).json({ error: "There's no conversation to practise yet." }); return; }
  try { const response = await anthropic().messages.parse({ model: MODEL, max_tokens: 1000, system: scenarioSystemPrompt({ mode: body.mode, difficulty }), messages: [...messages, { role: "user", content: "Set up the practice scenario for the situation we just discussed. Return only the scenario." }], output_config: { format: zodOutputFormat(ScenarioSchema) } }); const draft = response.parsed_output ?? fallback(response, ScenarioSchema); if (!draft?.counterpart?.trim()) { res.status(502).json({ error: "Couldn't set up the practice run. Try again." }); return; } res.set("cache-control", "no-store").json({ counterpart: draft.counterpart.trim(), situation: draft.situation?.trim() ?? "", opening: draft.opening?.trim() ?? "", difficulty }); } catch (err) { error(req, res, "/api/scenario", err); }
});
router.post("/debrief", async (req, res): Promise<void> => {
  const body = req.body; if (!body || typeof body !== "object") { res.status(400).json({ error: "Malformed request." }); return; }
  if (!isModeId(body.mode)) { res.status(400).json({ error: "Unknown mode." }); return; }
  const scenario = readScenario(body.scenario), messages = sanitiseTurns(body.messages); if (!messages.length) { res.status(400).json({ error: "There's nothing to look back on yet." }); return; }
  const summary = clampText(body.signalSummary, 4000), detail = clampText(body.signalDetail, 14000);
  const transcript = [scenario ? `The user was practising against: ${scenario.counterpart}.${scenario.situation ? ` Situation: ${scenario.situation}` : ""}` : "", "Transcript. THEM is the counterpart, ME is the user you are coaching:", scenario?.opening ? `THEM: ${scenario.opening}` : "", ...messages.map(m => `${m.role === "assistant" ? "THEM" : "ME"}: ${m.content}`)].filter(Boolean).join("\n");
  try {
    const analysis = async () => { if (!detail && !summary) return { noticed: [], cues: [] }; try { const response = await anthropic().messages.parse({ model: MODEL, max_tokens: 2000, system: deliveryAnalysisSystemPrompt({ mode: body.mode }), messages: [{ role: "user", content: `${transcript}\n\n${detail || summary}` }], output_config: { format: zodOutputFormat(AnalysisSchema) } }); return response.parsed_output ?? fallback(response, AnalysisSchema) ?? { noticed: [], cues: [] }; } catch (err) { req.log.error({ err }, "Delivery analysis failed"); return { noticed: [], cues: [] }; } };
    const write = async () => { const response = await anthropic().messages.parse({ model: MODEL, max_tokens: 2000, system: debriefSystemPrompt({ mode: body.mode as ModeId, hasSignals: summary.length > 0 }), messages: [{ role: "user", content: summary ? `${transcript}\n\nDelivery-signal summary:\n${summary}` : transcript }], output_config: { format: zodOutputFormat(DebriefSchema) } }); return response.parsed_output ?? fallback(response, DebriefSchema); };
    const [parsed, signals] = await Promise.all([write(), analysis()]);
    if (!parsed) { res.status(502).json({ error: "Couldn't put the debrief together. Try again." }); return; }
    const lines = (values: string[], max: number) => values.map(cleanLine).filter(Boolean).slice(0, max);
    res.set("cache-control", "no-store").json({ score: Math.min(10, Math.max(1, Math.round(parsed.score))), verdict: cleanLine(parsed.verdict), strengths: lines(parsed.strengths, 3), improvements: lines(parsed.improvements, 3), stronger_line: lines(parsed.stronger_line, 4), noticed: lines(signals.noticed, 4), cues: lines(signals.cues, 3) });
  } catch (err) { error(req, res, "/api/debrief", err); }
});
router.get("/avatar", async (req, res): Promise<void> => {
  const config = spatiusConfig(); const diagnostic = (reason: string) => process.env.NODE_ENV === "production" ? undefined : reason;
  if (!config) { const missing = missingSpatiusVars(), reason = `not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} unset. Add them to .env.local and restart the dev server.`; req.log.warn({ reason }, "Avatar unavailable"); res.set("cache-control", "no-store").json({ available: false, reason: diagnostic(reason) }); return; }
  const controller = new AbortController(); req.on("aborted", () => controller.abort());
  try { const { token, expiresAt } = await sessionToken(controller.signal); res.set("cache-control", "no-store").json({ available: true, ...config, sessionToken: token, expiresAt }); } catch (err) { if (req.aborted) { res.status(499).end(); return; } const detail = err instanceof Error ? err.message : String(err); req.log.error({ err }, "Avatar session token request failed"); res.set("cache-control", "no-store").json({ available: false, reason: diagnostic(`session token request failed: ${detail}`) }); }
});
router.get("/speak", (_req, res): void => { res.set("cache-control", "no-store").json({ available: sarvamConfigured(), speaker: DEFAULT_SPEAKER }); });
router.post("/speak", async (req, res): Promise<void> => {
  if (!sarvamConfigured()) { res.status(503).json({ error: "Voice is not configured." }); return; }
  const body = req.body; if (!body || typeof body !== "object") { res.status(400).json({ error: "Malformed request." }); return; }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 3000) : ""; if (!text) { res.status(400).json({ error: "Nothing to say." }); return; }
  const speaker = isSpeaker(body.speaker) ? body.speaker : DEFAULT_SPEAKER, format = body.format === "pcm" ? "pcm" : "mp3";
  const controller = new AbortController(); req.on("aborted", () => controller.abort());
  try { const upstream = await speak({ text, speaker, format, signal: controller.signal }); if (!upstream.ok || !upstream.body) { const detail = await upstream.text().catch(() => ""); req.log.error({ status: upstream.status, detail: detail.slice(0, 300) }, "Sarvam response failed"); res.status(upstream.status === 402 || upstream.status === 429 ? upstream.status : 502).json({ error: "Voice is unavailable right now." }); return; } res.status(200).set({ "content-type": CONTENT_TYPE[format], "cache-control": "no-store" }); Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res); } catch (err) { if (req.aborted) { res.status(499).end(); return; } req.log.error({ err }, "Speech provider failed"); res.status(502).json({ error: "Voice is unavailable right now." }); }
});
export default router;