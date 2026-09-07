import { isSpeaker } from "./voices";
const ENDPOINT = "https://api.sarvam.ai/text-to-speech/stream";
export const DEFAULT_SPEAKER = isSpeaker(process.env.SARVAM_SPEAKER) ? process.env.SARVAM_SPEAKER : "shubh";
export const CONTENT_TYPE = { mp3: "audio/mpeg", pcm: "audio/pcm" } as const;
export type SpeechFormat = keyof typeof CONTENT_TYPE;
export function sarvamConfigured() { return Boolean(process.env.SARVAM_API_KEY); }
export async function speak(o: { text: string; speaker: string; format: SpeechFormat; signal?: AbortSignal }) { const key = process.env.SARVAM_API_KEY; if (!key) throw new Error("SARVAM_API_KEY is not set"); return fetch(ENDPOINT, { method: "POST", headers: { "api-subscription-key": key, "content-type": "application/json" }, signal: o.signal, body: JSON.stringify({ text: o.text, model: process.env.SARVAM_MODEL ?? "bulbul:v3", speaker: o.speaker, language_code: "en-IN", output_audio_codec: o.format === "pcm" ? "linear16" : "mp3", ...(o.format === "pcm" ? { speech_sample_rate: 24000 } : {}), pace: 0.95 }) }); }