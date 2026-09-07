import { CONTENT_TYPE, DEFAULT_SPEAKER, sarvamConfigured, speak, type SpeechFormat } from "@/lib/sarvam";
import { isSpeaker } from "@/lib/voices";

export const dynamic = "force-dynamic";

/** Bulbul v3 caps streaming input; we chunk by sentence well below this anyway. */
const MAX_CHARS = 3000;

export async function GET() {
  // The client asks once on mount so it knows whether to use Bulbul or fall
  // back to speechSynthesis, without ever seeing the key.
  return Response.json(
    { available: sarvamConfigured(), speaker: DEFAULT_SPEAKER },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(request: Request) {
  if (!sarvamConfigured()) {
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
    const upstream = await speak({ text, speaker, format, signal: request.signal });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("[/api/speak] sarvam responded", upstream.status, detail.slice(0, 300));
      // 402 means credits ran out; the client falls back rather than going silent.
      return Response.json(
        { error: "Voice is unavailable right now." },
        { status: upstream.status === 402 || upstream.status === 429 ? upstream.status : 502 }
      );
    }

    // Passed straight through, still streaming: the client starts playing on
    // the first chunk rather than waiting for the sentence to finish.
    return new Response(upstream.body, {
      headers: {
        "content-type": CONTENT_TYPE[format],
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[/api/speak]", err);
    return Response.json({ error: "Voice is unavailable right now." }, { status: 502 });
  }
}
