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

/**
 * Turns a literal backslash-u escape back into the character it names.
 *
 * Structured output occasionally hands back a string containing the six
 * characters — rather than an em dash, and it lands on the debrief screen
 * exactly like that. Nothing a coach writes legitimately contains that
 * sequence, so decoding it is safe, and a stray — in the middle of "what
 * to sharpen" reads as the app being broken.
 */
export function decodeStrayEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex: string) => {
    const code = parseInt(hex, 16);
    // Lone surrogates would produce broken text; leave those alone.
    return code >= 0xd800 && code <= 0xdfff ? whole : String.fromCharCode(code);
  });
}

/** Every string the model writes goes through here before the UI sees it. */
export function cleanLine(text: string): string {
  return decodeStrayEscapes(text).trim();
}
