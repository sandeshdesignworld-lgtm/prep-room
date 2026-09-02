import { lastSentenceBoundary, forSpeaking } from "../.test-build/speech-text.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

// --- boundary detection ---
eq("no complete sentence yet", lastSentenceBoundary("How are yo"), 0);
eq("one sentence", lastSentenceBoundary("Hello there. How are"), 12);
eq("takes the LAST boundary", lastSentenceBoundary("One. Two. Three"), 9);
eq("decimal is not a boundary", lastSentenceBoundary("It costs 4.5 lakh"), 0);
eq("question mark", lastSentenceBoundary("Why though? Because"), 11);
eq("ellipsis", lastSentenceBoundary("Well… maybe"), 5);
eq("terminator at very end", lastSentenceBoundary("Done."), 5);
eq("empty", lastSentenceBoundary(""), 0);

// --- streaming simulation: nothing spoken twice, nothing dropped ---
const reply = "Blanking happens under pressure. Fix: memorise four anchors. Say it out loud, not in your head. Want to roleplay?";
let cursor = 0;
const spoken = [];
for (let i = 1; i <= reply.length; i += 7) {          // arbitrary chunk sizes
  const full = reply.slice(0, i);
  const b = lastSentenceBoundary(full.slice(cursor));
  if (b > 0) { spoken.push(full.slice(cursor, cursor + b)); cursor += b; }
}
spoken.push(reply.slice(cursor));                      // flush()
eq("stream reassembles exactly", spoken.join(""), reply);
eq("split into 4 sentences", spoken.filter(s => s.trim()).length, 4);

// --- speech sanitising ---
eq("strips bullet markers", forSpeaking("- Write it down\n- Say it aloud"), "Write it down Say it aloud");
eq("strips smart quotes", forSpeaking('He said “I’m ready”'), "He said Im ready");
eq("collapses whitespace", forSpeaking("too    many\n\n spaces"), "too many spaces");
eq("empty stays empty", forSpeaking("  \n  "), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
