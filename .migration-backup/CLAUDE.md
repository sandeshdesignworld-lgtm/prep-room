# PrepRoom — Build Brief (v1, full spec)

This supersedes any earlier brief. It is the plan for building PrepRoom. **Build in phases, in order, and get each phase running before starting the next.** Two reference files go alongside this (shared earlier in chat — keep them in the project folder):

- **`interview-coach.jsx`** — a working prototype of the coaching brain and a per-answer feedback flow. Reference for behaviour and prompt style. Caveat: it called Claude with **no API key** via a claude.ai artifact feature — your real app must call the API from a **server** (see Backend).
- **`pose_coach_starter.py`** — reference implementation of the webcam delivery signals (Python + MediaPipe). Port this logic to the browser in Phase 4.

## What we're building
A communication coach you talk to. You bring a real situation, it asks a sharp question or two, then gives you specific, usable advice — and when you're ready, it **role-plays the situation with you out loud** so you can practise, then debriefs you. First market: Indian college students / freshers, campus placements.

Three modes, one engine:
- **General advisor** — talk through any real situation (a tough conversation, asking for a raise), get concrete advice.
- **Interview prep** — mock interviews for placements; coaching on answers and delivery.
- **Social confidence** — low-pressure practice for everyday social situations.

Same engine throughout; the mode changes the scenarios, the tone, and the shape of the feedback (see Modes).

## Core product principles
- **The advisor is home.** You land in a conversation, not a menu. Practice is something the advisor hands you into.
- **Real advice, not tips.** Every response names the user's specific situation and gives concrete moves + actual words + the trap to avoid — never a generic listicle. This is the whole differentiator; protect it.
- **Voice and typing everywhere.** The user can speak or type at every step. Optionally the advisor speaks its replies too (see Voice).
- **Practice is roleplay.** The agent plays the counterpart (the interviewer, the teammate) and the user has the conversation turn by turn. Coaching comes **after**, as a debrief — never mid-conversation (that makes people choke).
- **Privacy is real, and it's a feature.** Camera processed on-device, video never uploaded; store notes, not video; the user can delete anything.

## Build order (do not skip ahead)
1. **Phase 1 — Advisor core (the brain), text-based.** Onboarding (trust + quick setup) -> the talk-it-through advisor across all three modes (asks 1-2 questions, then gives specific advice, offers to practise) -> save the session. Deploy it. Testable immediately.
2. **Phase 2 — Voice.** Speech-to-text input everywhere (Web Speech API) and optional text-to-speech output for the advisor (speechSynthesis).
3. **Phase 3 — Roleplay practice.** The live back-and-forth where the agent plays the counterpart; inline in the thread with a "go full-screen" option; ends -> debrief (score, what worked, what to sharpen, a stronger line). Scaffold the nudge toggle (default off).
4. **Phase 4 — Delivery signals.** MediaPipe (Face + Pose) capturing signals invisibly during roleplay; a signal timeline in the debrief; implement the gentle ambient nudge (the "on" state of the toggle). Port `pose_coach_starter.py`.
5. **Phase 5 — History, progress, polish.** History of past sessions, progress over time, data/privacy controls, consent + privacy policy.

## Recommended stack
- **Next.js (App Router) + React + Tailwind CSS** — one project for frontend + backend routes.
- **Backend:** Next.js Route Handlers calling the Anthropic API server-side. Routes: `/api/advisor` (multi-turn chat), `/api/roleplay` (multi-turn, in character), `/api/debrief` (returns JSON).
- **Speech-to-text:** Web Speech API (browser, free) for v1. Upgrade path: Deepgram / Whisper.
- **Text-to-speech (advisor voice):** browser `speechSynthesis` for v1. Upgrade path: ElevenLabs / cloud TTS.
- **Delivery signals (Phase 4):** `@mediapipe/tasks-vision` — `FaceLandmarker` (blendshapes) + `PoseLandmarker`, in the browser.
- **Data:** a DB for saved sessions + progress (e.g. Postgres / Supabase). Store transcripts + signal timelines + scores. **Never store video.**
- **Deploy:** Vercel.

## Backend — the one important change from the prototype
Never put the API key in client code. Call the API from a server route:
- Endpoint: `POST https://api.anthropic.com/v1/messages`
- Headers: `x-api-key: $ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- Body: `{ model, max_tokens, system, messages }` — send the full conversation history each turn for the multi-turn routes.
- Read `ANTHROPIC_API_KEY` from `.env.local` (never commit).
- **Model:** a current model — the API currently offers `claude-sonnet-5` (balanced, recommended), `claude-opus-4-8`, `claude-haiku-4-5`. Confirm latest at https://docs.claude.com/en/docs/overview.

## The AI pieces (ground truth)

### 1. Advisor (Phase 1) — multi-turn conversation
System (adapt {mode} tone per Modes):
> You are a sharp, warm communication coach for {audience}. The user brings a real situation. Do NOT give advice on the first message — first ask one or two targeted questions to understand who is involved, the history, what the user fears, and the outcome they want. Ask only what you need to be specific (two or three questions maximum), then commit to concrete advice. Your advice must be specific to THIS situation: name what's actually going on, give concrete moves and the actual words to use, and flag the trap they're about to walk into. Never give generic principles they already know. Once you've given the advice, offer to role-play the situation so they can practise it out loud. Keep it conversational and human.

Send the running conversation each turn. The app decides when the user taps "practise this" -> starts a roleplay.

### 2. Roleplay (Phase 3) — multi-turn, in character
System:
> You are role-playing a realistic practice scenario to help the user rehearse. Play the COUNTERPART in character — {counterpart, e.g. "the interviewer for a {role} campus placement" or "a teammate whose work has been slipping"}. Respond naturally, in character, one turn at a time, reacting to what the user actually says (push back, warm up, or get defensive as the character realistically would). Stay in character. Do NOT coach, break character, or evaluate during the roleplay — that happens afterward. Difficulty: {level}.

Send the running roleplay each turn. End on user request or a natural close.

### 3. Debrief (Phase 3; signals added in Phase 4) — returns JSON
System (adapt tone per Modes):
> You are a communication coach. The user just finished a practice roleplay. Based on the full transcript{, and the delivery-signal summary if provided}, give a debrief. Be specific to what they actually said and did — never generic. Return ONLY a JSON object with keys: score (integer 1-10), verdict (2-4 word phrase), strengths (array of 1-3 short strings), improvements (array of 1-3 short actionable strings), stronger_line (array of 2-4 short bullets — a better way to handle a key moment), delivery (array of short observations tied to moments, from the signal summary — physical only, e.g. "eye contact dropped each time they pushed back"; empty array if no signals). Calibrate for {audience}.

Parse JSON defensively (strip ```json fences; fall back to the first `{...}`).

(The per-answer feedback prompt in `interview-coach.jsx` is still useful if you add a "quick question drill" — keep it as an option, but the main practice is roleplay.)

## Modes — same engine, different tone + output
- **General advisor:** prioritised, plain recommendations — "here are the two things to do next, and how." Warm and direct.
- **Interview prep:** score + specifics + a stronger-answer sketch. Calibrate scoring for a fresher, not a senior hire. Counterpart = interviewer.
- **Social confidence:** concrete, literal, low-shame, encouraging. Never clinical, never an emotion verdict ("you seemed anxious"). This is a **practice aid, NOT therapy or diagnosis** — say so, and keep the tone gentle. Counterpart = the everyday situation.

## Delivery signals (Phase 4 — port from `pose_coach_starter.py`)
Report **physical/behavioural** signals, NEVER emotion labels. The debrief interprets them.
- `FaceLandmarker` (blendshapes on): smile = avg(`mouthSmileLeft`, `mouthSmileRight`); brow tension = avg(`browDownLeft`, `browDownRight`); gaze-down = avg(`eyeLookDownLeft`, `eyeLookDownRight`); mouth-open = `jawOpen`.
- Head orientation from the facial transformation matrix -> eye-contact proxy (facing the camera when |yaw| < ~18 deg, |pitch| < ~14 deg).
- `PoseLandmarker` -> shoulders (11/12): posture openness, tilt; nose movement over a rolling window -> fidget.
- Capture these **invisibly** during the roleplay and build a lightweight timeline (values over time, aligned to turns). Summarise it and pass it into `/api/debrief` so the debrief can tie delivery to specific moments. Do NOT show live coaching from these during the roleplay.

## The nudge toggle (Phase 3 scaffold, Phase 4 live) — keep it testable
A setting, not a hardcoded choice:
- **Off (default):** no in-roleplay feedback; everything comes in the debrief.
- **On:** a gentle AMBIENT cue only — a soft dot or subtle colour shift on screen. Never text sentences, never a voice interrupting mid-answer.

Build the safe ambient nudge so the user can run sessions both ways and decide. The question being tested is "gentle ambient nudge vs none" — do not build interrupting nudges.

## Privacy + data (build in; surface in Phase 5)
- The camera feed is processed **on-device** (MediaPipe in the browser). Raw video is NEVER uploaded or stored. Store only the notes: transcript, signal timeline, scores.
- Sessions are private to the user, encrypted at rest, and deletable — any one session, or wipe everything.
- Analytics: de-identified usage patterns only (frequency, modes used), kept separate from the content of conversations. Never mine personal conversations.
- Never train on or share user sessions.
- Onboarding includes a plain-language trust screen + consent. Before launch: a real privacy policy and DPDP Act (India) compliance. Doubly important because some users are vulnerable — treat it as a requirement.

## Screens
Welcome + trust · Quick setup (mode, about you, voice/typing preference, goal) · Advisor (home; voice + typing; the conversation) · Practice (roleplay inline in the thread, with a go-full-screen button; nudge toggle) · Debrief (score, what worked, sharpen, stronger line, signal timeline; shape adapts per mode) · History + data (past sessions, progress, delete controls).

## Design — palette + direction (FINAL: "French Poppy")
Calm, focused, encouraging, trustworthy — people share vulnerable things here, so low cognitive load and a settling feel matter more than flash. Warm, muted, grown-up: not loud, not childish. One bold accent, used sparingly — **one primary (orange) action per screen**, everything else quiet.

**Palette** — these are fixed brand colours (do not theme-shift them in light mode). Put them in ONE place (CSS variables or the Tailwind theme config) so the whole app reads tokens, not scattered hex.

- Page background — cream `#F5EBE0`
- Cards — white `#FFFFFF` on the cream page
- Surfaces / borders / dividers — greige `#D4C6BA` (borders 0.5px); subtle fills use a lighter greige `#EFE7DD` / `#F2ECE3`
- Text (ink) — warm charcoal `#33302B`; secondary `#7C7468`; muted / placeholder `#A89D8C`
- Primary action / key highlight — poppy orange `#D66536` (white text). Main CTA, Save, the "practise" chip — ONE per screen.
- Positive / progress / "what worked" — sage `#929673`
- Calm accent / info / trust cues / links — dusty blue `#718EAF`
- Highlight / score chips — muted yellow `#D1C481` (dark text `#3B3520` on it)
- Danger / delete (derived — not in the source set) — brick red `#B4472F`
- Chat bubbles — user = light blue tint `#DCE6F0` (text `#2C3A48`); coach = light greige `#F2ECE3` (text `#33302B`)

**Usage / contrast rules:**
- Charcoal ink on cream / white / greige = good contrast; use it for all body copy.
- Muted yellow, greige, and other light fills are low-contrast — use them as surfaces, never as text colour.
- White text only on the orange and brick-red fills; everywhere else use ink.
- Keep the identity distinctly "French Poppy" (not generic cream + terracotta) by leaning on **sage and dusty blue as much as orange**, and holding orange to one moment per screen.

**Dark mode:** derive a warm-dark variant — a deep warm charcoal-brown base (not pure black), slightly brighter sage / blue / orange accents, cream for text. Build the token set so light and dark both work from one switch.

## Guardrails / decisions
- Never expose the API key client-side.
- Coaching never interrupts a live roleplay — debrief only (except the optional gentle ambient nudge).
- Report physical signals, never emotion verdicts.
- Social-confidence mode is a practice aid, not therapy or diagnosis — frame it that way.
- Keep mode-specific behaviour in config / scenario-pack modules, not hardcoded into the engine.
- Web Speech API: feature-detect, fall back to typing.

## First message to give Claude Code
> Read CLAUDE.md. Scaffold a Next.js + Tailwind app called `prep-room`, wired to the French Poppy palette (put the colours in the Tailwind theme / CSS variables up front). Build **Phase 1 only**: onboarding (a trust/consent screen + a short setup that captures mode, a bit about the user, and voice-or-typing preference), then the advisor — a multi-turn chat backed by `POST /api/advisor` calling the Anthropic API server-side (key from `.env.local`) with the advisor system prompt in the brief, that asks one or two clarifying questions before giving specific advice and then offers to practise. Support typing now; leave clean seams for voice, roleplay, and signals to be added in later phases. Save each session. Get it running locally end-to-end before anything else.
