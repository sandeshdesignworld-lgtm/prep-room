import type { Difficulty, Scenario } from "./types";

export const DIFFICULTIES: Difficulty[] = ["gentle", "realistic", "tough"];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  gentle: "Gentle",
  realistic: "Realistic",
  tough: "Tough",
};

export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  gentle: "They give you room",
  realistic: "How it'd actually go",
  tough: "They push hard",
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as string[]).includes(value);
}

/** Validates a scenario that arrived from the client before it reaches a prompt. */
export function readScenario(value: unknown): Scenario | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const counterpart = typeof v.counterpart === "string" ? v.counterpart.trim().slice(0, 400) : "";
  const situation = typeof v.situation === "string" ? v.situation.trim().slice(0, 800) : "";
  const opening = typeof v.opening === "string" ? v.opening.trim().slice(0, 800) : "";
  if (!counterpart) return null;
  return {
    counterpart,
    situation,
    opening,
    difficulty: isDifficulty(v.difficulty) ? v.difficulty : "realistic",
  };
}
