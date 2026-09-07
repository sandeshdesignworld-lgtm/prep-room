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

export type AvatarStatus = "off" | "loading" | "ready" | "failed";

/**
 * Every way this can not happen, named.
 *
 * The fallback is meant to be invisible to a user mid-conversation, and it
 * should stay that way. But "invisible to the user" turned into "invisible to
 * whoever is building the thing", which is how you end up staring at a monogram
 * with no idea whether the credentials are wrong, the network is down, or you
 * simply have read-aloud switched off. Each of these logs a line saying which
 * one it was and what to do about it.
 */
export type AvatarFailureCode =
  | "muted"
  | "no-voice"
  | "not-configured"
  | "config-failed"
  | "sdk-failed"
  | "assets-failed"
  | "connect-failed"
  | "timeout"
  | "runtime"
  | "crashed";

export interface AvatarFailure {
  code: AvatarFailureCode;
  /** Shown to the user. Says what they get, and what to press if they can fix it. */
  message: string;
  /** Shown only outside production, and always logged. Says what actually broke. */
  detail: string;
}

const FAILURE: Record<AvatarFailureCode, { message: string; detail: string }> = {
  muted: {
    message:
      "Your coach's face needs read-aloud on. Tap the speaker above the transcript and they'll appear.",
    detail:
      "Read-aloud is off. The avatar is driven by the coach's own speech audio, so with nothing to speak there is nothing to drive it, and the SDK is deliberately not loaded.",
  },
  "no-voice": {
    message: "Voice only for now. Your coach is here, just without a face.",
    detail:
      "Sarvam is not configured, so there is no coach audio to drive the avatar with. Set SARVAM_API_KEY in .env.local and restart the dev server.",
  },
  "not-configured": {
    message: "Voice only for now. Your coach is here, just without a face.",
    detail:
      "GET /api/avatar reported the avatar is not set up. Set SPATIUS_APP_ID, SPATIUS_API_KEY and SPATIUS_AVATAR_ID in .env.local and restart the dev server. The server log names which one is missing.",
  },
  "config-failed": {
    message: "Voice only for now. Your coach is here, just without a face.",
    detail:
      "GET /api/avatar failed. Either the app can't be reached or the Spatius console rejected the session-token request; the server log has the status.",
  },
  "sdk-failed": {
    message: "Couldn't load your coach's avatar, so this one is voice only. Nothing else changes.",
    detail:
      "@spatius/avatarkit failed to import or initialize. Usually the WASM assets: check that next.config.mjs still wraps the config in withAvatarkit and that /_avatarkit/*.wasm returns 200 with content-type application/wasm.",
  },
  "assets-failed": {
    message: "Couldn't load your coach's avatar, so this one is voice only. Nothing else changes.",
    detail:
      "The avatar assets failed to download. Check SPATIUS_AVATAR_ID names an avatar this account owns, and that the network allows the Spatius CDN.",
  },
  "connect-failed": {
    message: "Couldn't load your coach's avatar, so this one is voice only. Nothing else changes.",
    detail:
      "Connecting to the motion server failed. A rejected session token, an expired one, or no route to api.<region>.spatius.ai.",
  },
  timeout: {
    message: "Your coach took too long to arrive, so this one is voice only.",
    detail: `Nothing was ready within ${AVATAR_LOAD_TIMEOUT_MS}ms. Usually a slow connection pulling the avatar assets; the network tab will show what was still in flight.`,
  },
  runtime: {
    message: "Lost your coach's picture, so the rest of this is voice only.",
    detail:
      "AvatarKit reported an error or dropped its connection after it had started. The code beside this line is the SDK's own.",
  },
  crashed: {
    message: "Your coach's avatar stopped working, so this one is voice only.",
    detail: "The avatar render tree threw and was removed by the error boundary.",
  },
};

/** Still spoken while the SDK is on its way. */
export const AVATAR_LOADING_MESSAGE = "Bringing your coach in…";

/**
 * One place that says it out loud. Every fallback goes through here, so there
 * is no path from "it works" to "a monogram" that leaves nothing in the console.
 */
function failureOf(code: AvatarFailureCode, detail?: string): AvatarFailure {
  const base = FAILURE[code];
  return {
    code,
    message: base.message,
    detail: detail ? `${base.detail}\n  Underlying: ${detail}` : base.detail,
  };
}

function logFailure(failure: AvatarFailure): void {
  // Read-aloud being off is a setting, not a fault, so it doesn't shout.
  const log = failure.code === "muted" ? console.info : console.error;
  log(
    `[Prime AI avatar] falling back to voice-only (${failure.code}).\n  ${failure.detail}\n  The session is unaffected: the coach still talks, and everything else works.`
  );
}

/** Derived rather than stored, so it needs no state write. */
const MUTED = failureOf("muted");

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

/** Anything thrown, as one line worth logging. */
function message(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

interface Config {
  available: boolean;
  /** Development only: which piece of configuration is missing. */
  reason?: string;
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
  onPlaybackStall: ((stalled: boolean) => void) | null;
  frameStarvationMode: string;
  initializeAudioContext: () => Promise<void>;
  start: () => Promise<void>;
  send: (audio: ArrayBuffer, end?: boolean) => string | null;
  interrupt: () => void;
  close: () => void;
};
type View = { controller: Controller; dispose: () => void; onFirstRendering?: () => void };

export function useAvatar({
  enabled,
  /** False when read-aloud is off, which is a fixable reason rather than a fault. */
  voiced = true,
  container,
}: {
  enabled: boolean;
  voiced?: boolean;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  /**
   * What the load got to. The status the room sees is this only while the
   * avatar is switched on, so turning it off is a derived "off" rather than a
   * state write, and turning it back on re-runs the load rather than showing
   * whatever the last attempt happened to end at.
   */
  const [loaded, setLoaded] = useState<AvatarStatus>("loading");
  /** Why there's no face, when there isn't one. Null while it's fine. */
  const [failure, setFailure] = useState<AvatarFailure | null>(null);

  /** Records the reason, logs it, and drops to voice-only. */
  const fail = useCallback((code: AvatarFailureCode, detail?: string) => {
    const next = failureOf(code, detail);
    logFailure(next);
    setFailure(next);
    setLoaded("failed");
  }, []);
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
    if (!enabled || !voiced) return;

    const runId = ++runRef.current;
    const live = () => runRef.current === runId;

    // One deadline over the whole chain rather than one per step: what matters
    // to someone waiting is how long until there is a coach, not which of four
    // network calls was the slow one.
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      if (!live() || readyRef.current) return;
      timedOut = true;
      teardown();
      fail("timeout");
    }, AVATAR_LOAD_TIMEOUT_MS);

    const boot = async () => {
      setLoaded("loading");
      setFailure(null);

      // The avatar is driven by the coach's own TTS audio. Without Bulbul there
      // is no audio to drive it with, and an avatar sitting still while the
      // browser's robot voice talks over it is worse than no avatar at all.
      if ((await resolveEngine()) !== "bulbul") {
        if (live()) fail("no-voice");
        return;
      }

      let config: Config;
      try {
        const res = await fetch("/api/avatar", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/avatar responded ${res.status}`);
        config = (await res.json()) as Config;
      } catch (err) {
        if (live() && !timedOut) fail("config-failed", message(err));
        return;
      }
      if (!live() || timedOut) return;
      if (!config.available || !config.appId || !config.avatarId || !config.sessionToken) {
        fail("not-configured", config.reason ?? "the server reported available: false");
        return;
      }

      // Everything below is the Direct Mode order from the Web SDK reference:
      // initialize with the app id, set the session token, load the avatar,
      // mount a view, open the audio context inside a gesture, then connect.
      let kit: typeof import("@spatius/avatarkit");
      try {
        kit = await import("@spatius/avatarkit");
        if (!live() || timedOut) return;
        await kit.AvatarSDK.initialize(config.appId, {
          region: config.region,
          drivingServiceMode: kit.DrivingServiceMode.direct,
          // The SDK's own logging, on in development. It is the only thing that
          // can explain a failure inside the renderer.
          logLevel:
            process.env.NODE_ENV === "production" ? kit.LogLevel.error : kit.LogLevel.warning,
          audioFormat: { channelCount: 1, sampleRate: AVATAR_SAMPLE_RATE },
        });
        kit.AvatarSDK.setSessionToken(config.sessionToken);
      } catch (err) {
        if (live() && !timedOut) fail("sdk-failed", message(err));
        return;
      }

      let avatar: Awaited<ReturnType<typeof kit.AvatarManager.shared.load>>;
      try {
        avatar = await kit.AvatarManager.shared.load(config.avatarId, (progress) => {
          if (progress.type === "failed") {
            console.error("[Prime AI avatar] asset download failed", progress.error);
          }
        });
      } catch (err) {
        if (live() && !timedOut) fail("assets-failed", message(err));
        return;
      }
      if (!live() || timedOut) return;

      const mount = container.current;
      if (!mount) {
        fail("assets-failed", "the container element was gone before the view could mount");
        return;
      }

      const view = new kit.AvatarView(avatar, mount) as unknown as View;
      viewRef.current = view;

      const controller = view.controller;

      /**
       * Audio waits for motion, rather than running ahead of it.
       *
       * The default is audioIndependent: if animation frames run short the
       * voice carries on and the mouth catches up later, which is exactly the
       * drift this is meant to remove. strictSync pauses the audio instead, so
       * the two can never separate. With PCM streaming straight from Sarvam the
       * server is comfortably ahead and this should almost never fire; when it
       * does, it says so rather than silently desyncing.
       */
      controller.frameStarvationMode = kit.FrameStarvationMode.strictSync;
      controller.onPlaybackStall = (stalled) => {
        if (stalled) {
          console.warn(
            "[Prime AI avatar] motion data ran short, holding the audio to keep the lips with it."
          );
        }
      };

      controller.onConversationState = (state) => {
        if (live()) setSpeaking(state === "playing");
      };
      controller.onConnectionState = (state) => {
        // A connection lost mid-session is a failure like any other: hand the
        // voice back to the browser rather than going quiet.
        if (live() && state === "failed") {
          readyRef.current = false;
          fail("runtime", "the motion-server connection reported state: failed");
        }
      };
      controller.onError = (error) => {
        if (!live()) return;
        readyRef.current = false;
        fail("runtime", `AvatarKit error ${error?.code ?? "(no code)"}: ${error?.message ?? ""}`);
      };

      try {
        // Entering the room now always follows a click on the home screen, so
        // the gesture requirement is satisfied. If it ever isn't, this throws
        // and says so rather than leaving a mute avatar on screen.
        await controller.initializeAudioContext();
        await controller.start();
      } catch (err) {
        if (live() && !timedOut) fail("connect-failed", message(err));
        return;
      }
      if (!live() || timedOut) return;

      readyRef.current = true;
      setFailure(null);
      setLoaded("ready");
      console.info(
        `[Prime AI avatar] ready. avatar ${config.avatarId} in ${config.region ?? "us-west"}, driving audio at ${AVATAR_SAMPLE_RATE}Hz.`
      );
    };

    boot().catch((err) => {
      if (!live()) return;
      teardown();
      fail("sdk-failed", message(err));
    });

    return () => {
      window.clearTimeout(deadline);
      teardown();
    };
  }, [enabled, voiced, container, teardown, fail]);

  // Read-aloud off isn't a fault, but it is the single most common reason to be
  // looking at a monogram and it is one tap to fix, so it still says so once.
  const muted = enabled && !voiced;
  useEffect(() => {
    if (muted) logFailure(MUTED);
  }, [muted]);

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
  /**
   * The error boundary's way in. A throw inside the render tree is the one
   * failure the hook cannot see for itself, and it has to land in the same
   * place as every other one rather than silently blanking the canvas.
   */
  const reportCrash = useCallback(() => {
    teardown();
    fail("crashed");
  }, [teardown, fail]);

  // Muted is derived, not stored: it is a straight function of a prop, and
  // writing it into state from an effect would be a render for nothing.
  const status: AvatarStatus = !enabled ? "off" : muted ? "failed" : loaded;
  const shown = muted ? MUTED : status === "failed" ? failure : null;

  return { status, speaking, sink, failure: shown, reportCrash };
}
