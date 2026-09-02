/**
 * Server-only. Sarvam's Bulbul text-to-speech, used because the browser's own
 * speechSynthesis reads Indian English like a train announcement.
 *
 * The key is read from the environment and must never reach the client, same
 * rule as the Anthropic key. If it isn't configured the app falls back to
 * speechSynthesis rather than losing voice entirely.
 */
import { isSpeaker } from "./voices";

const ENDPOINT = "https://api.sarvam.ai/text-to-speech/stream";

export const SARVAM_MODEL = process.env.SARVAM_MODEL ?? "bulbul:v3";

/** Override with SARVAM_SPEAKER once you've auditioned them at /voices. */
export const DEFAULT_SPEAKER = isSpeaker(process.env.SARVAM_SPEAKER)
  ? process.env.SARVAM_SPEAKER
  : "shubh";

export function sarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

/** Streaming keeps time-to-first-audio short; the body is raw mp3, not JSON. */
export async function speak(opts: {
  text: string;
  speaker: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not set");

  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "api-subscription-key": key,
      "content-type": "application/json",
    },
    signal: opts.signal,
    body: JSON.stringify({
      text: opts.text,
      model: SARVAM_MODEL,
      speaker: opts.speaker,
      language_code: "en-IN",
      output_audio_codec: "mp3",
      // A hair under conversational speed; the default rushes the coaching lines.
      pace: 0.95,
    }),
  });
}
