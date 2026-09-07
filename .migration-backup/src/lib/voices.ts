/**
 * Bulbul v3 speakers, taken from the API's own rejection message rather than the
 * docs page, which mixes in v2-only voices (anushka, abhilash, karun, hitesh).
 * Sending a v2 speaker to v3 is a 400, so this list has to stay exact. Note that
 * Sarvam's own error message advertises "niharika", which the API then rejects as
 * unrecognised, so it is deliberately absent. All 37 below are verified working.
 *
 * Shared with the client, so nothing env-dependent belongs here.
 */
export const SPEAKERS = [
  "shubh", "aditya", "ritu", "ashutosh", "priya", "neha", "rahul", "pooja",
  "rohan", "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan",
  "varun", "manan", "sumit", "roopa", "kabir", "aayan", "advait", "anand",
  "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
  "mohit", "kavitha", "rehan", "soham", "rupali",
] as const;

export type Speaker = (typeof SPEAKERS)[number];

export function isSpeaker(value: unknown): value is Speaker {
  return typeof value === "string" && (SPEAKERS as readonly string[]).includes(value);
}
