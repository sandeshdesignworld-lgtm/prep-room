"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Welcome from "@/components/onboarding/Welcome";
import Setup from "@/components/onboarding/Setup";
import Chat from "@/components/advisor/Chat";
import AppShell, { type View } from "@/components/app/AppShell";
import HistoryView from "@/components/app/HistoryView";
import ProgressView from "@/components/app/ProgressView";
import DataView from "@/components/app/DataView";
import {
  CONSENT_VERSION,
  getProfileServerSnapshot,
  getProfileSnapshot,
  getSessionsServerSnapshot,
  getSessionsSnapshot,
  deleteSession,
  newSession,
  saveProfile,
  subscribeProfile,
  subscribeSessions,
} from "@/lib/storage";
import type { Session } from "@/lib/types";

export default function Home() {
  // The profile lives in localStorage, which doesn't exist during SSR. Subscribing
  // to it keeps the first paint hydration-safe: `undefined` until the browser
  // has actually been read, so we never flash the wrong screen.
  const profile = useSyncExternalStore(
    subscribeProfile,
    getProfileSnapshot,
    getProfileServerSnapshot
  );
  const sessions = useSyncExternalStore(
    subscribeSessions,
    getSessionsSnapshot,
    getSessionsServerSnapshot
  );

  const [accepted, setAccepted] = useState(false);
  const [view, setView] = useState<View>("advisor");
  // Set when the user opens a specific thread from History; otherwise we resume
  // whatever they were last on.
  const [opened, setOpened] = useState<Session | null>(null);

  const resumed = useMemo(
    () => (profile ? (sessions[0] ?? newSession(profile.mode)) : null),
    // Only the newest session matters here, and re-deriving on every list change
    // would swap the thread out from under someone mid-sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile]
  );

  if (profile === undefined) {
    return <div className="min-h-dvh bg-page" />;
  }

  // A changed privacy notice means asking again rather than assuming.
  const needsConsent = profile === null || profile.consentVersion !== CONSENT_VERSION;

  if (needsConsent) {
    return accepted ? (
      <Setup onDone={saveProfile} />
    ) : (
      <Welcome onAccept={() => setAccepted(true)} />
    );
  }

  const session = opened ?? resumed;
  if (!session) return null;

  function open(next: Session) {
    setOpened(next);
    setView("advisor");
  }

  function remove(id: string) {
    deleteSession(id);
    // If that was the thread on screen, replace it, because otherwise the next message
    // would save it straight back into history.
    if (session && session.id === id && profile) setOpened(newSession(profile.mode));
  }

  return (
    <AppShell view={view} onChange={setView}>
      {view === "advisor" && (
        <Chat key={session.id} profile={profile} initialSession={session} />
      )}

      {view === "history" && (
        <HistoryView
          sessions={sessions}
          onOpen={open}
          onDelete={remove}
          onStartNew={() => open(newSession(profile.mode))}
        />
      )}

      {view === "progress" && <ProgressView sessions={sessions} />}

      {view === "data" && (
        <DataView
          profile={profile}
          sessions={sessions}
          onWiped={() => {
            setOpened(null);
            setAccepted(false);
            setView("advisor");
          }}
          onOpenHistory={() => setView("history")}
        />
      )}
    </AppShell>
  );
}
