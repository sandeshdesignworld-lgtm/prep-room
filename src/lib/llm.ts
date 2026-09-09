import type { z } from "zod";
import type { Turn } from "./types";

/**
 * One coach, two engines.
 *
 * Every model call in the app goes through here so that a provider running out
 * of credit is an inconvenience rather than an outage. The routes do not know
 * which company answered them, and nothing about a provider leaks past this
 * file: prompts, schemas and the shape of a reply are identical either way.
 *
 * Order is a setting, not a decision baked into the code. LLM_PRIMARY picks who
 * goes first; whoever is left is the fallback, and a provider with no key is
 * skipped rather than attempted and failed.
 */

export type ProviderName = "openai" | "anthropic";

export interface LlmCall {
  system: string;
  messages: Turn[];
  maxTokens: number;
}

export interface Provider {
  readonly name: ProviderName;
  /** Whether this provider has a key at all. No key is not a failure, it is an absence. */
  configured(): boolean;
  /** Text deltas as they arrive. Must throw rather than yield nothing on failure. */
  streamText(call: LlmCall): AsyncIterable<string>;
  /** One JSON object matching the schema, or null if the model wrote something else. */
  parseJson<T extends z.ZodType>(
    call: LlmCall,
    schema: T,
    schemaHint: string,
  ): Promise<z.infer<T> | null>;
}

/* --------------------------- who answers, in what order --------------------------- */

let registry: Provider[] = [];

/** Called once at module load by the provider files themselves. */
export function register(provider: Provider): void {
  registry = [...registry.filter((p) => p.name !== provider.name), provider];
}

function primaryName(): ProviderName {
  return process.env.LLM_PRIMARY === "anthropic" ? "anthropic" : "openai";
}

/**
 * The providers to try, best first, skipping any without a key.
 *
 * A provider with no key is not an error worth reporting: running only on
 * Anthropic is a perfectly reasonable way to configure this app, and so is
 * running only on OpenAI.
 */
export function providerOrder(): Provider[] {
  const primary = primaryName();
  const ranked = [...registry].sort((a, b) => {
    if (a.name === primary) return -1;
    if (b.name === primary) return 1;
    return 0;
  });
  return ranked.filter((p) => p.configured());
}

/* ------------------------------ what is worth failing over ------------------------------ */

export class NoProviderError extends Error {
  constructor() {
    super("No model provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
    this.name = "NoProviderError";
  }
}

/** The HTTP status an SDK error carries, whichever SDK threw it. */
export function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m.toLowerCase();
  }
  return "";
}

/**
 * Whether this failure is the PROVIDER's problem, and therefore worth asking
 * somebody else.
 *
 * The distinction that matters: a request we built wrong will be built wrong
 * for the second provider too, so retrying it just doubles the latency before
 * the same failure. Out of credit, rate limited, rejected key, or their servers
 * being down are all worth a second opinion.
 *
 * Exhausted credit is the awkward one. OpenAI reports it as 429 with the code
 * insufficient_quota; Anthropic reports it as a plain 400 whose message names
 * the credit balance. A bare 400 is otherwise our own fault, so the message is
 * read rather than the status.
 */
export function isProviderFault(err: unknown): boolean {
  const status = statusOf(err);
  const message = messageOf(err);

  // Out of money, whoever is saying it and however they say it.
  if (
    message.includes("credit balance") ||
    message.includes("insufficient_quota") ||
    message.includes("insufficient quota") ||
    message.includes("exceeded your current quota") ||
    message.includes("billing")
  ) {
    return true;
  }

  if (status === null) {
    // A connection that never landed. Nothing was wrong with the request.
    return message.includes("connection") || message.includes("timeout") || message.includes("econn");
  }

  // 401/403 rejected key, 402 payment, 404 a model this account cannot see,
  // 429 rate or quota, 5xx theirs.
  return (
    status === 401 || status === 402 || status === 403 || status === 404 || status === 429 || status >= 500
  );
}

/* ---------------------------------- the two calls ---------------------------------- */

export interface Attempt {
  provider: ProviderName;
  error: unknown;
}

export class AllProvidersFailed extends Error {
  readonly attempts: Attempt[];
  constructor(attempts: Attempt[]) {
    super("Every model provider failed.");
    this.name = "AllProvidersFailed";
    this.attempts = attempts;
  }
  /** The failure the user is most entitled to hear about: the primary's. */
  get first(): unknown {
    return this.attempts[0]?.error;
  }
}

/**
 * Stream text, failing over before the first character reaches the user.
 *
 * This is the whole reason the first chunk is awaited here rather than piped
 * straight out. Once a byte has been written the response is committed: the
 * status is sent, the client is reading, and switching providers mid-sentence
 * would splice two different replies together. So the first delta is pulled
 * inside the try, where a failure is still recoverable, and only then is the
 * rest handed over.
 */
export async function streamText(
  call: LlmCall,
  label: string,
): Promise<{ provider: ProviderName; stream: AsyncIterable<string> }> {
  const providers = providerOrder();
  if (providers.length === 0) throw new NoProviderError();

  const attempts: Attempt[] = [];

  for (const provider of providers) {
    const iterator = provider.streamText(call)[Symbol.asyncIterator]();
    try {
      // Pull until there is actually something to say. An empty first delta is
      // common and is not a reply.
      let first = await iterator.next();
      while (!first.done && !first.value) first = await iterator.next();

      if (first.done) throw new Error(`${provider.name} closed the stream without writing anything.`);

      const opening = first.value;
      console.info(`[${label}] answered by ${provider.name}`);
      return {
        provider: provider.name,
        stream: (async function* () {
          yield opening;
          while (true) {
            const next = await iterator.next();
            if (next.done) return;
            if (next.value) yield next.value;
          }
        })(),
      };
    } catch (err) {
      attempts.push({ provider: provider.name, error: err });
      await iterator.return?.(undefined).catch(() => {});
      if (!isProviderFault(err)) break;
      console.warn(`[${label}] ${provider.name} failed, trying the next provider.`, err);
    }
  }

  throw new AllProvidersFailed(attempts);
}

/** The same failover, for the routes that want one JSON object rather than prose. */
export async function parseJson<T extends z.ZodType>(
  call: LlmCall,
  schema: T,
  schemaHint: string,
  label: string,
): Promise<z.infer<T> | null> {
  const providers = providerOrder();
  if (providers.length === 0) throw new NoProviderError();

  const attempts: Attempt[] = [];

  for (const provider of providers) {
    try {
      const parsed = await provider.parseJson(call, schema, schemaHint);
      console.info(`[${label}] answered by ${provider.name}`);
      return parsed;
    } catch (err) {
      attempts.push({ provider: provider.name, error: err });
      if (!isProviderFault(err)) break;
      console.warn(`[${label}] ${provider.name} failed, trying the next provider.`, err);
    }
  }

  throw new AllProvidersFailed(attempts);
}

/* ------------------------------- telling the user ------------------------------- */

/**
 * Turn a failure into a status and a sentence that is actually true.
 *
 * The old version of this said "the coach couldn't answer that one, try again"
 * for a provider that was out of credit, which invited a retry that could not
 * possibly work and hid the one fact the operator needed. Money, keys and
 * outages are now named.
 */
export function describeFailure(err: unknown): { status: number; message: string } {
  if (err instanceof NoProviderError) {
    return { status: 500, message: "The server isn't configured with an API key yet." };
  }

  const real = err instanceof AllProvidersFailed ? err.first : err;
  const status = statusOf(real);
  const message = messageOf(real);

  if (
    message.includes("credit balance") ||
    message.includes("quota") ||
    message.includes("billing")
  ) {
    return {
      status: 402,
      message: "The coach is out of credit. Top up the API account and it'll start answering again.",
    };
  }
  if (status === 401 || status === 403) {
    return { status: 500, message: "The server's API key was rejected." };
  }
  if (status === 429) {
    return { status: 429, message: "That was a lot at once. Give it a few seconds and try again." };
  }
  if (status !== null && status >= 500) {
    return { status: 502, message: "The coach's service is having a moment. Try again shortly." };
  }
  if (status === null && (message.includes("connection") || message.includes("timeout"))) {
    return { status: 503, message: "Couldn't reach the coach. Check your connection and try again." };
  }
  return { status: status ?? 500, message: "The coach couldn't answer that one. Try again." };
}
