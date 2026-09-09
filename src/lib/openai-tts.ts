/**
 * Server-only OpenAI text-to-speech fallback.
 *
 * OpenAI's PCM response is 24 kHz, mono, signed 16-bit little-endian audio,
 * which is the same wire format AvatarKit's direct mode accepts. Keeping this
 * as a response stream means the avatar can start moving before the sentence
 * is fully generated.
 */
import type { SpeechFormat } from "./sarvam";

const ENDPOINT = "https://api.openai.com/v1/audio/speech";
const MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = process.env.OPENAI_TTS_VOICE ?? "coral";

export function openaiTtsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function openaiTtsVoice(): string {
  return VOICE;
}

export async function speakWithOpenAI(opts: {
  text: string;
  format: SpeechFormat;
  signal?: AbortSignal;
}): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: opts.text,
      response_format: opts.format,
      ...(MODEL === "gpt-4o-mini-tts"
        ? { instructions: "Speak warmly, clearly, and conversationally in Indian English." }
        : {}),
    }),
  });
}