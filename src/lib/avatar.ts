"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AVATAR_SAMPLE_RATE, silence } from "./pcm";
import { resolveEngine } from "./speech";

/**
 * The coach's face. Spatius AvatarKit, in Direct Mode: the coach's TTS audio
 * goes from this page to the Spatius motion server, motion data comes back, and
 * the avatar is rendered and the audio played locally on a canvas we own.
 *
 * Everything in here is written on the assumption that it will sometimes not
 * work. It is a third-party WebGPU renderer pulling ten megabytes of assets
 * over someone's college wifi, and the session has to survive that: any
 * failure, and the timeout below, leave `status` at "failed" and the room
 * carries on voice-only, which is exactly the app as it was before the avatar
 * existed.
 *
 * The SDK is imported dynamically, so none of it is in the main bundle and a
 * module that throws on evaluation is caught like any other failure.
 */

/**
 * How long the whole chain gets: config, SDK, avatar assets, first connection.
 * Generous, because the assets are large and this is a first market on slow
 * connections, but finite, because a spinner that never resolves is worse than
 * a coach with no face.
 */
export const AVATAR_LOAD_TIMEOUT_MS = 30000;

/** Closes a speech turn. Inaudible, and long enough for the server to finalise. */
const END_SILENCE_MS = 60;

export type AvatarStatus =
  | "off"
  | "unavailable"
  | "loading"
  | "ready"
  | "failed";

export const AVATAR_MESSAGE: Record<Exclude<AvatarStatus, "off" | "ready">, string> = {
  unavailable: "Voice only for now. Your coach is here, just without a face.",
  loading: "Bringing your coach in…",
  failed: "Couldn't load your coach's avatar, so this one is voice only. Nothing else changes.",
};

/** What the speaker hands audio to when the avatar is the one talking. */
export interface AvatarSink {
  ready: boolean;
  /** One sentence of PCM16. False means it couldn't be taken; play it normally. */
  send: (pcm: ArrayBuffer) => boolean;
  /** End of this reply, so playback finishes and the avatar settles back to idle. */
  finish: () => void;
  /** Drop everything queued and stop talking. Barge-in lands here. */
  interrupt: () => void;
}

interface Config {
  available: boolean;
  appId?: string;
  avatarId?: string;
  region?: string;
  sessionToken?: string;
}

/** Only the bits of the SDK this file touches, so the import stays honest. */
type Controller = {
  onConnectionState: ((state: string) => void) | null;
  onConversationState: ((state: string) => void) | null;
  onError: ((error: { code?: string; message?: string }) => void) | null;
  initializeAudioContext: () => Promise<void>;
  start: () => Promise<void>;
  send: (audio: ArrayBuffer, end?: boolean) => string | null;
  interrupt: () => void;
  close: () => void;
};
type View = { controller: Controller; dispose: () => void; onFirstRendering?: () => void };

export function useAvatar({
  enabled,
  container,
}: {
  enabled: boolean;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  /**
   * What the load got to. The status the room sees is this only while the
   * avatar is switched on, so turning it off is a derived "off" rather than a
   * state write, and turning it back on re-runs the load rather than showing
   * whatever the last attempt happened to end at.
   */
  const [loaded, setLoaded] = useState<AvatarStatus>("loading");
  /** True while the avatar is actually saying something. Drives barge-in. */
  const [speaking, setSpeaking] = useState(false);

  const viewRef = useRef<View | null>(null);
  const readyRef = useRef(false);
  /** Bumped on every teardown, so an in-flight load can't attach afterwards. */
  const runRef = useRef(0);

  const teardown = useCallback(() => {
    runRef.current += 1;
    readyRef.current = false;
    const view = viewRef.current;
    viewRef.current = null;
    if (view) {
      try {
        view.controller.close();
        view.dispose();
      } catch {
        // Already gone. Nothing here is worth failing a page teardown over.
      }
    }
    setSpeaking(false);
  }, []);

  useEffect(() => {
    // Nothing to set up, and nothing to tear down here either: switching the
    // avatar off runs the previous run's cleanup, which is where teardown lives.
    if (!enabled) return;

    const runId = ++runRef.current;
    const live = () => runRef.current === runId;

    // One deadline over the whole chain rather than one per step: what matters
    // to someone waiting is how long until there is a coach, not which of four
    // network calls was the slow one.
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      if (!live() || readyRef.current) return;
      timedOut = true;
      console.warn("[avatar] gave up after", AVATAR_LOAD_TIMEOUT_MS, "ms");
      teardown();
      setLoaded("failed");
    }, AVATAR_LOAD_TIMEOUT_MS);

    const boot = async () => {
      setLoaded("loading");

      // The avatar is driven by the coach's own TTS audio. Without Bulbul there
      // is no audio to drive it with, and an avatar sitting still while the
      // browser's robot voice talks over it is worse than no avatar at all.
      if ((await resolveEngine()) !== "bulbul") {
        if (live()) setLoaded("unavailable");
        return;
      }

      const res = await fetch("/api/avatar", { cache: "no-store" });
      const config = (res.ok ? await res.json() : { available: false }) as Config;
      if (!live() || timedOut) return;
      if (!config.available || !config.appId || !config.avatarId || !config.sessionToken) {
        setLoaded("unavailable");
        return;
      }

      const kit = await import("@spatius/avatarkit");
      if (!live() || timedOut) return;

      await kit.AvatarSDK.initialize(config.appId, {
        region: config.region,
        drivingServiceMode: kit.DrivingServiceMode.direct,
        logLevel: kit.LogLevel.error,
        audioFormat: { channelCount: 1, sampleRate: AVATAR_SAMPLE_RATE },
      });
      kit.AvatarSDK.setSessionToken(config.sessionToken);

      const avatar = await kit.AvatarManager.shared.load(config.avatarId);
      if (!live() || timedOut) return;

      const mount = container.current;
      if (!mount) throw new Error("avatar container went away");

      const view = new kit.AvatarView(avatar, mount) as unknown as View;
      viewRef.current = view;

      const controller = view.controller;
      controller.onConversationState = (state) => {
        if (live()) setSpeaking(state === "playing");
      };
      controller.onConnectionState = (state) => {
        // A connection lost mid-session is a failure like any other: hand the
        // voice back to the browser rather than going quiet.
        if (live() && state === "failed") {
          readyRef.current = false;
          setLoaded("failed");
        }
      };
      controller.onError = (error) => {
        console.error("[avatar]", error?.code, error?.message);
        if (!live()) return;
        readyRef.current = false;
        setLoaded("failed");
      };

      // The room is entered by clicking, so the gesture requirement is already
      // satisfied; if it isn't, this throws and we fall back like anything else.
      await controller.initializeAudioContext();
      await controller.start();
      if (!live() || timedOut) return;

      readyRef.current = true;
      setLoaded("ready");
    };

    boot().catch((err) => {
      console.error("[avatar] failed to load", err);
      if (!live()) return;
      teardown();
      setLoaded("failed");
    });

    return () => {
      window.clearTimeout(deadline);
      teardown();
    };
  }, [enabled, container, teardown]);

  /**
   * Handed to the speaker. Every method is a no-op when the avatar isn't
   * ready, so the caller never has to ask first, and `send` returning false is
   * the signal to play the clip the ordinary way instead.
   *
   * Deliberately not awaiting anything: audio is pushed as fast as it arrives
   * and the motion server keeps up on its own. Waiting on motion before playing
   * a sentence would put the lag into the coach's voice, which is the one place
   * it would be unbearable.
   */
  const sink = useMemo<AvatarSink>(() => ({
    // A getter, so nothing has to write to this during a render to keep it true.
    get ready() {
      return readyRef.current;
    },
    send: (pcm) => {
      const controller = viewRef.current?.controller;
      if (!controller || !readyRef.current) return false;
      try {
        controller.send(pcm, false);
        return true;
      } catch (err) {
        console.error("[avatar] send failed", err);
        return false;
      }
    },
    finish: () => {
      const controller = viewRef.current?.controller;
      if (!controller || !readyRef.current) return;
      try {
        // A short run of silence carries the end flag. The SDK takes the flag on
        // an audio call, and there isn't always a real last sentence to hang it
        // on, so this is the one that ends the turn.
        controller.send(silence(END_SILENCE_MS), true);
      } catch (err) {
        console.error("[avatar] finish failed", err);
      }
    },
    interrupt: () => {
      const controller = viewRef.current?.controller;
      if (!controller || !readyRef.current) return;
      try {
        controller.interrupt();
      } catch {
        // Nothing playing, or already torn down.
      }
    },
  }), []);
  const status: AvatarStatus = enabled ? loaded : "off";

  return { status, speaking, sink };
}
