"use client";

import type { Message, ModeId, Profile, Session } from "./types";

/**
 * Phase 1 persistence: the browser. Sessions never leave the device yet, which
 * matches what the trust screen promises. Phase 5 swaps the bodies of these
 * functions for API calls, the call sites shouldn't need to change.
 */
const PROFILE_KEY = "preproom.profile.v1";
const SESSIONS_KEY = "preproom.sessions.v1";

/**
 * Bump when the privacy policy changes materially. A profile carrying an older
 * version is re-asked for consent rather than quietly carried over.
 *
 * 2026-09-04: the room now opens with the camera on rather than asking per
 * rehearsal. Nothing about where the frames go changed, but when the camera
 * switches on did, and that is exactly the kind of thing someone agreed to
 * under the old wording and should get to agree to again.
 */
export const CONSENT_VERSION = "2026-09-04";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota; the session stays in memory for this visit.
  }
}

export function loadProfile(): Profile | null {
  return read<Profile | null>(PROFILE_KEY, null);
}

export function saveProfile(profile: Profile): void {
  write(PROFILE_KEY, profile);
  emit();
}

/* ---- profile as an external store, so React can read it hydration-safely ---- */

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeProfile(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab editing the same profile should update this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// useSyncExternalStore requires a referentially stable snapshot, so the parsed
// profile is cached and only rebuilt when the raw stored string actually changes.
let cachedRaw: string | null = null;
let cachedProfile: Profile | null = null;

export function getProfileSnapshot(): Profile | null {
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedProfile = raw ? (JSON.parse(raw) as Profile) : null;
    } catch {
      cachedProfile = null;
    }
  }
  return cachedProfile;
}

/** `undefined` means "not read yet": the server and the first paint. */
export function getProfileServerSnapshot(): undefined {
  return undefined;
}

export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

let cachedSessionsRaw: string | null = null;
let cachedSessions: Session[] = [];

export function getSessionsSnapshot(): Session[] {
  const raw = window.localStorage.getItem(SESSIONS_KEY);
  if (raw !== cachedSessionsRaw) {
    cachedSessionsRaw = raw;
    cachedSessions = loadSessions();
  }
  return cachedSessions;
}

export function getSessionsServerSnapshot(): Session[] {
  return EMPTY_SESSIONS;
}

/** A stable identity, so the server snapshot never trips an infinite re-render. */
const EMPTY_SESSIONS: Session[] = [];

/**
 * Everything this app holds about the user, as one JSON file. Part of the
 * promise: what we keep is inspectable, not just deletable.
 */
export function exportEverything(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      note: "This is everything PrepRoom has stored about you. It lives in your browser, not on a server.",
      profile: loadProfile(),
      sessions: loadSessions(),
    },
    null,
    2
  );
}

export function loadSessions(): Session[] {
  const sessions = read<Session[]>(SESSIONS_KEY, []);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveSession(session: Session): void {
  const rest = loadSessions().filter((s) => s.id !== session.id);
  write(SESSIONS_KEY, [session, ...rest]);
  emit();
}

export function deleteSession(id: string): void {
  write(
    SESSIONS_KEY,
    loadSessions().filter((s) => s.id !== id)
  );
  emit();
}

/** The Phase 5 "wipe everything" control, available from the start. */
export function deleteEverything(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSIONS_KEY);
  window.localStorage.removeItem(PROFILE_KEY);
  emit();
}

export function newSession(mode: ModeId): Session {
  const now = new Date().toISOString();
  return { id: uid(), mode, title: "New conversation", messages: [], createdAt: now, updatedAt: now };
}

export function newMessage(role: Message["role"], content: string): Message {
  return { id: uid(), role, content, createdAt: new Date().toISOString() };
}

/** A thread is named after the user's opening line, which is what they'll recognise. */
export function titleFor(session: Session): string {
  const first = session.messages.find((m) => m.role === "user")?.content.trim();
  if (!first) return "New conversation";
  const clipped = first.length > 52 ? `${first.slice(0, 52).trimEnd()}…` : first;
  return clipped.replace(/\s+/g, " ");
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
