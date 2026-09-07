"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Welcome from "@/components/onboarding/Welcome";
import Setup from "@/components/onboarding/Setup";
import Room from "@/components/room/Room";
import HomeScreen from "@/components/app/Home";
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
import type { ModeId, Session } from "@/lib/types";

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
  /**
   * Null until the user picks something on the home screen. This is what keeps
   * the camera off: Room is what asks for it, and Room is not mounted until
   * there is a mode here. Starts null every session on purpose, so a reload
   * lands on the doorway rather than in a live call.
   */
  const [entered, setEntered] = useState<ModeId | null>(null);

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

  function open(next: Session) {
    setOpened(next);
    // Opening a specific thread is itself the choice the home screen asks for.
    setEntered(next.mode);
    setView("advisor");
  }

  /** A card on the home screen. The first click of the session, and the one
   *  that earns the camera prompt. */
  function enter(mode: ModeId) {
    const current = opened ?? resumed;
    // Carry on with the thread already in progress when it's the same mode;
    // anything else starts clean rather than switching tone mid-conversation.
    setOpened(current && current.mode === mode ? current : newSession(mode));
    setEntered(mode);
    setView("advisor");
  }

  const session = opened ?? resumed;
  if (!session) return null;

  function remove(id: string) {
    deleteSession(id);
    // If that was the thread on screen, replace it, because otherwise the next message
    // would save it straight back into history.
    if (session && session.id === id && profile) setOpened(newSession(profile.mode));
  }

  return (
    <AppShell
      view={view}
      onChange={setView}
      onHome={() => {
        setEntered(null);
        setView("advisor");
      }}
      atHome={entered === null}
    >
      {view === "advisor" &&
        (entered === null ? (
          <HomeScreen onPick={enter} goal={profile.goal} />
        ) : (
          <Room key={session.id} profile={profile} initialSession={session} />
        ))}

      {view === "history" && (
        <HistoryView
          sessions={sessions}
          onOpen={open}
          onDelete={remove}
          onStartNew={() => enter(profile.mode)}
        />
      )}

      {view === "progress" && <ProgressView sessions={sessions} />}

      {view === "data" && (
        <DataView
          profile={profile}
          sessions={sessions}
          onWiped={() => {
            setOpened(null);
            setEntered(null);
            setAccepted(false);
            setView("advisor");
          }}
          onOpenHistory={() => setView("history")}
        />
      )}
    </AppShell>
  );
}
