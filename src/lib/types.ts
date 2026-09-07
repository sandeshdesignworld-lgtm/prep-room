import type { Sample as SignalSample } from "./signals-math";

export type { Sample as SignalSample } from "./signals-math";

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
  /**
   * Send the user's turn on its own once they stop speaking. Undefined on
   * profiles saved before the setting existed, and reads as on: this is a
   * voice-first product and pressing Send every turn is what it's avoiding.
   */
  autoSend?: boolean;
  /** Bulbul speaker id. Undefined means the server default. */
  voice?: string;
  /** Phase 3/4: gentle ambient nudge during roleplay. Default off, deliberately. */
  ambientNudge: boolean;
  consentedAt: string;
  /** Which version of the privacy notice they agreed to. */
  consentVersion: string;
  createdAt: string;
}

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

export type Difficulty = "gentle" | "realistic" | "tough";

/** Who the user is about to practise against, derived from the advisor thread. */
export interface Scenario {
  /** Fills {counterpart} in the roleplay prompt, e.g. "the interviewer for a TCS placement". */
  counterpart: string;
  /** One line of situation the character needs to stay consistent. */
  situation: string;
  /** What the counterpart says first, so the user never faces a blank screen. */
  opening: string;
  difficulty: Difficulty;
}

export interface Roleplay {
  scenario: Scenario;
  /** `user` is the user; `assistant` is the counterpart in character. */
  messages: Message[];
  startedAt: string;
  endedAt?: string;
  /** Downsampled to ~1Hz before storage. Physical signals only, never emotions. */
  signals?: SignalSample[];
}

export interface Debrief {
  score: number;
  verdict: string;
  strengths: string[];
  improvements: string[];
  stronger_line: string[];
  /** Empty until Phase 4 supplies delivery signals. */
  delivery: string[];
}

export interface Session {
  id: string;
  mode: ModeId;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  roleplay?: Roleplay;
  debrief?: Debrief;
}

export type Turn = Pick<Message, "role" | "content">;

/** Request body for POST /api/advisor. */
export interface AdvisorRequest {
  mode: ModeId;
  about: string;
  goal: string;
  messages: Turn[];
}

/** POST /api/scenario, turns the advisor thread into something to practise against. */
export interface ScenarioRequest {
  mode: ModeId;
  difficulty: Difficulty;
  messages: Turn[];
}

/** POST /api/roleplay, the counterpart's next line, in character. */
export interface RoleplayRequest {
  mode: ModeId;
  scenario: Scenario;
  messages: Turn[];
}

/** POST /api/debrief, coaching, after the roleplay is over. */
export interface DebriefRequest {
  mode: ModeId;
  scenario: Scenario;
  messages: Turn[];
  /** Phase 4: a summary of the delivery-signal timeline. */
  signalSummary?: string;
}
