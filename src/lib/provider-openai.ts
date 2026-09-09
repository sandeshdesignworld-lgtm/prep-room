import OpenAI from "openai";
import type { z } from "zod";
import { register, type LlmCall, type Provider } from "./llm";
import { parseJsonLoose } from "./json";

/**
 * The OpenAI half of the coach.
 *
 * Server-only. Nothing here may be imported from a "use client" component.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

/**
 * Structured output, the portable way.
 *
 * json_object mode guarantees syntactically valid JSON but not our shape, so
 * the schema is described in the prompt and the result validated afterwards.
 * That is deliberately the same belt-and-braces the Anthropic path already
 * had: a debrief that fails to parse is a dead end for the user, and one
 * provider silently returning a different shape than the other would be a bug
 * nobody notices until a real session.
 */
function jsonInstruction(hint: string): string {
  return `\n\nReply with ONE JSON object and nothing else. No prose, no code fence. Shape:\n${hint}`;
}

const provider: Provider = {
  name: "openai",

  configured() {
    return !!process.env.OPENAI_API_KEY;
  },

  async *streamText(call: LlmCall) {
    const stream = await openai().chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: call.maxTokens,
      stream: true,
      messages: [{ role: "system", content: call.system }, ...call.messages],
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  },

  async parseJson<T extends z.ZodType>(call: LlmCall, schema: T, schemaHint: string) {
    const response = await openai().chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: call.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: call.system + jsonInstruction(schemaHint) },
        ...call.messages,
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";
    const loose = parseJsonLoose<unknown>(text);
    if (loose === null) return null;

    const checked = schema.safeParse(loose);
    return checked.success ? (checked.data as z.infer<T>) : null;
  },
};

register(provider);
export default provider;
