import { missingSpatiusVars, spatiusConfig, sessionToken } from "@/lib/spatius";

/**
 * Names of unset environment variables are about this deployment, not about any
 * user, so they are safe to hand back while someone is building. They are still
 * withheld in production, where nobody is reading them and the only audience is
 * a stranger with the URL.
 */
function diagnostic(reason: string): string | undefined {
  return process.env.NODE_ENV === "production" ? undefined : reason;
}

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
    const missing = missingSpatiusVars();
    const reason = `not configured: ${missing.join(", ")} ${
      missing.length === 1 ? "is" : "are"
    } unset. Add them to .env.local and restart the dev server.`;
    // Logged in every environment, so a silent avatar always has a paper trail.
    console.warn(`[/api/avatar] ${reason}`);
    return Response.json(
      { available: false, reason: diagnostic(reason) },
      { headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const { token, expiresAt } = await sessionToken(request.signal);
    return Response.json(
      { available: true, ...config, sessionToken: token, expiresAt },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    // The user gets a coach with no face, which is the documented fallback,
    // rather than an error about a vendor they never chose. But it is always
    // logged here, and handed back while developing, so it is never a mystery.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[/api/avatar] session token request failed:", detail);
    return Response.json(
      { available: false, reason: diagnostic(`session token request failed: ${detail}`) },
      { headers: { "cache-control": "no-store" } }
    );
  }
}
