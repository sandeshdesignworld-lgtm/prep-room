export type ModeId = "general" | "interview" | "social";

export type InputPreference = "voice" | "typing";

export interface Profile {
  /** Mode chosen at setup. The user can switch later; this is just the default. */
  mode: ModeId;
  /** Free text: who they are, what they're preparing for. Fed into the system prompt. */
  about: string;
  /** What they want out of this. Also fed into the system prompt. */
  goal: string;
  /** Phase 2 reads this to decide whether to open the mic by default. */
  inputPreference: InputPreference;
  /** Phase 2: should the advisor speak its replies aloud. */
  speakReplies: boolean;
  /** Phase 3/4: gentle ambient nudge during roleplay. Default off, deliberately. */
  ambientNudge: boolean;
  consentedAt: string;
  createdAt: string;
}

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

export interface Session {
  id: string;
  mode: ModeId;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  /** Phase 3 fills these in. Declared now so stored sessions don't need migrating. */
  roleplay?: unknown;
  debrief?: unknown;
}

/** Request body for POST /api/advisor. */
export interface AdvisorRequest {
  mode: ModeId;
  about: string;
  goal: string;
  messages: Pick<Message, "role" | "content">[];
}
