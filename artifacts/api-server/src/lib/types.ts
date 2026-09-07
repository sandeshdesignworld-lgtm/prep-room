export type ModeId = "general" | "interview" | "social";
export type Difficulty = "gentle" | "realistic" | "tough";
export type Turn = { role: "user" | "assistant"; content: string };
export type Scenario = { counterpart: string; situation: string; opening: string; difficulty: Difficulty };