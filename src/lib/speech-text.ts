/**
 * Pure text helpers for streaming speech. Kept free of React and browser APIs
 * so they can be reasoned about, and tested, on their own.
 */

/** Ends a sentence when followed by whitespace or the end of what we have. */
const SENTENCE_END = /[.!?…](?=\s|$)/g;

/**
 * How much of `text` forms whole sentences. Returns 0 when there isn't a
 * complete one yet, so a half-finished sentence is never spoken early.
 * A decimal like "4.5" isn't a boundary, the dot isn't followed by a space.
 */
export function lastSentenceBoundary(text: string): number {
  let last = -1;
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
    last = m.index;
  }
  return last + 1;
}

/** Strips the markup the coach writes for the eye but that sounds wrong read out. */
export function forSpeaking(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[“”‘’"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Joins a dictated phrase onto whatever is already in the box. */
export function joinSpoken(existing: string, addition: string): string {
  if (!existing) return addition;
  if (!addition) return existing;
  return /\s$/.test(existing) ? existing + addition : `${existing} ${addition}`;
}
