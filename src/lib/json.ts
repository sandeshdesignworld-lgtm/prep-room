/**
 * Pulls a JSON object out of a model reply. Structured outputs make this a
 * fallback rather than the main path, but a debrief that fails to parse is a
 * dead end for the user, so the belt-and-braces is worth it.
 */
export function parseJsonLoose<T>(raw: string): T | null {
  const text = raw.trim();
  if (!text) return null;

  const attempts = [text, stripFence(text), firstObject(text)];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt) as T;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

function stripFence(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : null;
}

/** Scans for the first balanced {...}, ignoring braces inside strings. */
function firstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
