import type { Response, Request } from "express";
import type { Turn } from "./types";
const MAX_MESSAGES = 80, MAX_CHARS = 6000;
export function sanitiseTurns(input: unknown): Turn[] {
  const turns = (Array.isArray(input) ? input : []).filter((m): m is Turn => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0).map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) })).slice(-MAX_MESSAGES);
  while (turns.length && turns[0].role === "assistant") turns.shift(); return turns;
}
export function clampText(value: unknown, max = 1000): string { return typeof value === "string" ? value.slice(0, max) : ""; }
export async function pipeTextStream(stream: AsyncIterable<any> & { abort(): void }, req: Request, res: Response, label: string): Promise<void> {
  const abort = () => stream.abort(); req.on("aborted", abort); res.on("close", abort);
  res.status(200).set({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" }).flushHeaders();
  try { for await (const event of stream) if (event.type === "content_block_delta" && event.delta.type === "text_delta") res.write(event.delta.text); }
  catch (err) { if (!req.aborted) req.log.error({ err, label }, "Stream failed"); }
  finally { req.off("aborted", abort); res.off("close", abort); res.end(); }
}