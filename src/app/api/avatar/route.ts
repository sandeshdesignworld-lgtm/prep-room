import { spatiusConfig, sessionToken } from "@/lib/spatius";

export const dynamic = "force-dynamic";

/**
 * Everything the browser needs to put the coach on screen, and nothing it
 * shouldn't have. The app and avatar ids are public by nature; the API key stays
 * here and only ever produces a short-lived session token.
 *
 * `available: false` is a normal answer, not an error. The room reads it and
 * runs voice-only.
 */
export async function GET(request: Request) {
  const config = spatiusConfig();
  if (!config) {
    return Response.json({ available: false }, { headers: { "cache-control": "no-store" } });
  }

  try {
    const { token, expiresAt } = await sessionToken(request.signal);
    return Response.json(
      { available: true, ...config, sessionToken: token, expiresAt },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    // Logged, not surfaced: the user gets a coach with no face, which is the
    // documented fallback, rather than an error about a vendor they never chose.
    console.error("[/api/avatar]", err);
    return Response.json({ available: false }, { headers: { "cache-control": "no-store" } });
  }
}
