"use client";

import { Component, type ReactNode } from "react";

/**
 * A wall around the third-party renderer.
 *
 * `useAvatar` catches everything asynchronous, but AvatarKit also mounts a
 * WebGPU canvas into React's tree, and a throw during render or in a layout
 * effect there would take the whole room down with it: the conversation, the
 * transcript, the practice in progress. That is not an acceptable outcome for a
 * face on the screen.
 *
 * So: if the avatar subtree throws, it is removed, `onFail` tells the room to
 * fall back to voice-only, and the session carries on.
 */
export default class AvatarBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[avatar] render crashed", error);
    this.props.onFail();
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}
