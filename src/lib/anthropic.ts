import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-only. The API key is read from the environment and must never reach the
 * client, nothing in this file may be imported from a "use client" component.
 */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}
