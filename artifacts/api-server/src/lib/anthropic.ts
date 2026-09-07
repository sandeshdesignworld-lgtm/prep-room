import Anthropic, { APIConnectionError, APIError, APIUserAbortError, AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
let client: Anthropic | null = null;
export class MissingKeyError extends Error { constructor() { super("ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server."); this.name = "MissingKeyError"; } }
export function anthropic(): Anthropic { if (!client) { if (!process.env.ANTHROPIC_API_KEY) throw new MissingKeyError(); client = new Anthropic(); } return client; }
export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof MissingKeyError) return { status: 500, message: "The server isn't configured with an API key yet." };
  if (err instanceof AuthenticationError) return { status: 500, message: "The server's API key was rejected." };
  if (err instanceof RateLimitError) return { status: 429, message: "That was a lot at once. Give it a few seconds and try again." };
  if (err instanceof APIConnectionError) return { status: 503, message: "Couldn't reach the coach. Check your connection and try again." };
  if (err instanceof APIUserAbortError) return { status: 499, message: "Stopped." };
  if (err instanceof APIError) return { status: err.status ?? 500, message: "The coach couldn't answer that one. Try again." };
  return { status: 500, message: "Something went wrong. Try again." };
}