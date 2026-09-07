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

/** A clause break: somewhere a speaker would naturally draw breath. */
const CLAUSE_END = /[,;:](?=\s)/g;

/**
 * The shortest opening worth speaking on its own, in characters.
 *
 * Below this a fragment is a stub: "Right," said alone and then a pause while
 * the rest synthesises is worse than waiting half a second longer.
 */
export const FIRST_CHUNK_MIN = 40;
/** Past this, waiting for the full stop costs more than the odd break. */
export const FIRST_CHUNK_MAX = 140;

/**
 * How much of the FIRST chunk of a reply is worth speaking now.
 *
 * The rest of the reply chunks on sentences, which is right: it reads
 * naturally and nobody is waiting. The first one is different, because
 * everything before it is silence, and silence at the start of a turn is what
 * makes an app feel slow. So if a complete sentence has arrived, take it; if
 * one hasn't and the opening has run long, take a clause instead.
 */
export function firstChunkBoundary(text: string): number {
  const sentence = lastSentenceBoundary(text);
  if (sentence > 0) return sentence;
  if (text.length < FIRST_CHUNK_MAX) return 0;

  let last = -1;
  CLAUSE_END.lastIndex = 0;
  for (let m = CLAUSE_END.exec(text); m; m = CLAUSE_END.exec(text)) {
    if (m.index + 1 >= FIRST_CHUNK_MIN) last = m.index;
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
