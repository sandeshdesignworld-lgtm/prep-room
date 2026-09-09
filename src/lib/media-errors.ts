"use client";

/**
 * One place that turns a getUserMedia rejection into something true.
 *
 * Every media failure in this app used to collapse into two answers: "your
 * browser is blocking the camera" or "no camera on this device". Both are
 * confident, both are frequently wrong, and both send someone to a settings
 * screen that will not help them. A camera another app is holding is not a
 * denied camera. A constraint the phone cannot satisfy is not a missing
 * camera. An insecure origin is not a permission the user can grant.
 *
 * The browser already tells us which of these happened, in `err.name`. This
 * module stops throwing that away.
 *
 * Names are checked as strings rather than via instanceof DOMException: some
 * mobile browsers reject with a plain Error carrying the right `name`, and an
 * instanceof gate quietly reclassifies those as "unknown".
 */

export type MediaFailure =
  /** The user, or a standing site setting, said no. Only NotAllowedError. */
  | "denied"
  /** No such input on this device. */
  | "absent"
  /** Present, but another app or tab is holding it. */
  | "busy"
  /** Present, but it cannot do what we asked for. Retry with less. */
  | "mismatch"
  /** The page is not allowed to ask at all: insecure origin, or policy. */
  | "insecure"
  /** Something we have no accurate story for. */
  | "unknown";

/** The DOMException name, however the browser chose to deliver it. */
export function errorName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * Classify a getUserMedia rejection.
 *
 * The important line is the first one: ONLY NotAllowedError means denied.
 * SecurityError used to be lumped in with it, which told a user on an insecure
 * origin to go and grant a permission that was never the problem.
 */
export function classifyMediaError(err: unknown): MediaFailure {
  switch (errorName(err)) {
    case "NotAllowedError":
    case "PermissionDeniedError": // pre-standard Chrome, same meaning
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "absent";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "mismatch";
    case "SecurityError":
      return "insecure";
    default:
      return "unknown";
  }
}
