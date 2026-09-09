import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "./anthropic";
import { register, type LlmCall, type Provider } from "./llm";
import { parseJsonLoose } from "./json";

/**
 * The Anthropic half of the coach.
 *
 * Keeps the structured-output path it always had: this SDK can constrain the
 * model to the schema rather than asking nicely, which is strictly better, and
 * there is no reason to give that up just because a second provider cannot do
 * it. parseJsonLoose stays underneath as the same fallback it always was.
 */
const provider: Provider = {
  name: "anthropic",

  configured() {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async *streamText(call: LlmCall) {
    const stream = anthropic().messages.stream({
      model: MODEL,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: call.messages,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  },

  // schemaHint is ignored on purpose: this SDK constrains the model to the
  // schema itself, so describing the shape in prose as well would be noise.
  async parseJson<T extends z.ZodType>(call: LlmCall, schema: T) {
    const response = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: call.messages,
      output_config: { format: zodOutputFormat(schema) },
    });

    if (response.parsed_output) return response.parsed_output as z.infer<T>;

    // Structured output should make this unreachable; it is here so a hiccup
    // is not fatal.
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    const loose = parseJsonLoose<unknown>(text);
    if (loose === null) return null;
    const checked = schema.safeParse(loose);
    return checked.success ? (checked.data as z.infer<T>) : null;
  },
};

register(provider);
export default provider;
