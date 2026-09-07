/**
 * Server-only. Spatius AvatarKit's session-token flow, same rule as the
 * Anthropic and Sarvam keys: SPATIUS_API_KEY is read from the environment and
 * must never reach the browser.
 *
 * The app id and the avatar id DO go to the browser. That is by design, not an
 * oversight, the SDK needs both to fetch the avatar assets and open its socket.
 * What authorises a session is the short-lived token minted here.
 *
 * If any of this is unconfigured the app doesn't degrade, it simply has no
 * avatar and runs voice-only, which is the same shape it had before.
 */

const REGION_CONSOLE: Record<string, string> = {
  "us-west": "https://console.us-west.spatius.ai",
  "ap-northeast": "https://console.ap-northeast.spatius.ai",
  "cn-beijing": "https://console.cn-beijing.spatialwalk.top",
};

export const DEFAULT_REGION = "us-west";

/** Tokens are capped at an hour by the API. Well past any single session. */
const TOKEN_TTL_S = 55 * 60;
/**
 * Re-minted a little before it lapses. An expired token only blocks NEW
 * connections, so a session already in progress is never cut off by this.
 */
const REFRESH_MARGIN_S = 5 * 60;

export function spatiusRegion(): string {
  const region = process.env.SPATIUS_REGION ?? DEFAULT_REGION;
  return region in REGION_CONSOLE ? region : DEFAULT_REGION;
}

export interface SpatiusConfig {
  appId: string;
  avatarId: string;
  region: string;
}

/** Null when the avatar isn't set up, which is a perfectly fine way to run. */
export function spatiusConfig(): SpatiusConfig | null {
  const appId = process.env.SPATIUS_APP_ID?.trim();
  const avatarId = process.env.SPATIUS_AVATAR_ID?.trim();
  if (!appId || !avatarId || !process.env.SPATIUS_API_KEY) return null;
  return { appId, avatarId, region: spatiusRegion() };
}

interface CachedToken {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * One token per server instance, reused until it's nearly out.
 * Minting is a round trip to another continent and every reload of the room
 * would otherwise pay for it.
 */
let cached: CachedToken | null = null;

export async function sessionToken(signal?: AbortSignal): Promise<CachedToken> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - now > REFRESH_MARGIN_S) return cached;

  const key = process.env.SPATIUS_API_KEY;
  if (!key) throw new Error("SPATIUS_API_KEY is not set");

  const expireAt = now + TOKEN_TTL_S;
  const res = await fetch(`${REGION_CONSOLE[spatiusRegion()]}/v1/console/session-tokens`, {
    method: "POST",
    headers: { "X-API-Key": key, "content-type": "application/json" },
    signal,
    body: JSON.stringify({ expireAt }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`session token request failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const payload = (await res.json()) as { sessionToken?: unknown };
  if (typeof payload.sessionToken !== "string" || !payload.sessionToken) {
    throw new Error("session token response had no token");
  }

  cached = { token: payload.sessionToken, expiresAt: expireAt };
  return cached;
}
