import { CONTENT_TYPE, DEFAULT_SPEAKER, sarvamConfigured, speak, type SpeechFormat } from "@/lib/sarvam";
import { openaiTtsConfigured, openaiTtsVoice, speakWithOpenAI } from "@/lib/openai-tts";
import { isSpeaker } from "@/lib/voices";

export const dynamic = "force-dynamic";

/** Bulbul v3 caps streaming input; we chunk by sentence well below this anyway. */
const MAX_CHARS = 3000;

export async function GET() {
  // The client asks once on mount so it knows whether to use a server TTS
  // engine or fall back to speechSynthesis, without ever seeing a key.
  const provider = openaiTtsConfigured() ? "openai" : sarvamConfigured() ? "sarvam" : null;
  return Response.json(
    {
      available: provider !== null,
      provider,
      speaker: provider === "openai" ? openaiTtsVoice() : DEFAULT_SPEAKER,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(request: Request) {
  if (!sarvamConfigured() && !openaiTtsConfigured()) {
    return Response.json({ error: "Voice is not configured." }, { status: 503 });
  }

  let body: { text?: unknown; speaker?: unknown; format?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHARS) : "";
  if (!text) {
    return Response.json({ error: "Nothing to say." }, { status: 400 });
  }

  const speaker = isSpeaker(body.speaker) ? body.speaker : DEFAULT_SPEAKER;
  // Raw PCM when the avatar is going to play it, mp3 when an <audio> is.
  const format: SpeechFormat = body.format === "pcm" ? "pcm" : "mp3";

  try {
    /**
     * Prefer OpenAI when its key is present. Sarvam currently returns 402 when
     * its account has no credits, and retrying it for every sentence delays the
     * coach before the useful fallback can begin.
     */
    const providers = openaiTtsConfigured()
      ? (["openai", "sarvam"] as const)
      : (["sarvam", "openai"] as const);

    for (const provider of providers) {
      if (provider === "openai" && !openaiTtsConfigured()) continue;
      if (provider === "sarvam" && !sarvamConfigured()) continue;

      const upstream =
        provider === "openai"
          ? await speakWithOpenAI({ text, format, signal: request.signal })
          : await speak({ text, speaker, format, signal: request.signal });

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          headers: {
            "content-type": CONTENT_TYPE[format],
            "cache-control": "no-store",
            "x-voice-provider": provider,
          },
        });
      }

      const detail = await upstream.text().catch(() => "");
      console.error(`[/api/speak] ${provider} responded`, upstream.status, detail.slice(0, 300));
      if (request.signal.aborted) return new Response(null, { status: 499 });
    }

    return Response.json({ error: "Voice is unavailable right now." }, { status: 502 });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[/api/speak]", err);
    return Response.json({ error: "Voice is unavailable right now." }, { status: 502 });
  }
}
