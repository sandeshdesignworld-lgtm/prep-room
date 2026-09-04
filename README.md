# PrepRoom

A communication coach you talk to. Bring a real situation, get specific advice,
then rehearse it out loud.

The full product spec lives in [`CLAUDE.md`](./CLAUDE.md).

## Running it

```bash
npm install
cp .env.local.example .env.local   # then paste your key in
npm run dev
```

`.env.local` needs one value:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from the [Anthropic Console](https://console.anthropic.com/settings/keys).
`ANTHROPIC_MODEL` is optional and defaults to `claude-sonnet-5`.

For the coach's voice, add a [Sarvam](https://dashboard.sarvam.ai) key:

```
SARVAM_API_KEY=...
```

Without it the app falls back to the browser's `speechSynthesis`, which works but
sounds robotic on Indian English. Audition the voices at `/voices` and pick one;
your choice is saved to your profile, or set `SARVAM_SPEAKER` for the default.

Two things the API taught us the hard way, both encoded in `src/lib/voices.ts`:
`bulbul:v3` rejects v2-only speakers (anushka, abhilash, karun, hitesh) with a
400, and Sarvam's own error message advertises a `niharika` voice that the API
then refuses. The 37 names in that file are each verified against the live API.
Sarvam also rate-limits, so previewing voices in a fast burst returns 429; that
degrades to the browser voice rather than to silence.

Open http://localhost:3000.

```bash
npm test        # assertion suites for the pure modules
npm run build   # typecheck + production build
npm run lint
```

## Where things are

| Path | What it is |
|---|---|
| `src/app/globals.css` | The Crisp White palette. **Every colour in the app comes from here**, light and dark, one switch. |
| `src/lib/modes.ts` | Everything mode-specific: tone, audience, counterpart, openers, starters. The engine reads this instead of branching on the mode. |
| `src/lib/prompts.ts` | The advisor system prompt, plus the roleplay and debrief prompts for later phases. |
| `src/lib/anthropic.ts` | Server-only Anthropic client, model id, and error mapping. |
| `src/app/api/advisor/route.ts` | `POST /api/advisor`, multi-turn, streams the reply back as plain text. |
| `src/app/api/scenario/route.ts` | `POST /api/scenario`, reads the advisor thread and casts the counterpart. Structured output. |
| `src/app/api/roleplay/route.ts` | `POST /api/roleplay`, the counterpart's next line, in character, streamed. |
| `src/app/api/debrief/route.ts` | `POST /api/debrief`, scored debrief as JSON. Structured output, with `json.ts` as a fallback parser. |
| `src/components/room/` | The room: the call stage (hero camera, live pills, call controls), the signal cards under it, the coach panel on the right, and `Room.tsx` holding the session that runs through both. |
| `src/components/practice/` | Debrief card, ambient nudge, signal timeline. |
| `src/components/app/` | The icon rail, history, progress, and the data/privacy controls. |
| `src/lib/progress.ts` | Aggregates saved sessions into the progress numbers. Pure and tested. |
| `src/app/privacy/page.tsx` | The privacy notice. Static, readable without signing in. |
| `tests/` | Plain assertion scripts for every pure module. `npm test`. |
| `src/lib/signals-math.ts` | The delivery-signal maths, head angles, posture, movement, rollups, the debrief summary. Pure and fully tested. |
| `src/lib/signals.ts` | MediaPipe capture in the browser. Camera in, numbers out; no frame is kept. The camera and the analysis start separately. |
| `scripts/setup-mediapipe.mjs` | Copies the WASM runtime and downloads the models into `public/`. Runs before dev and build. |
| `src/lib/sarvam.ts` | Server-only Sarvam Bulbul client. Key never reaches the browser. |
| `src/app/api/speak/route.ts` | `POST /api/speak` streams one sentence of audio; `GET` reports whether voice is configured. |
| `src/app/voices/page.tsx` | Audition all 41 Bulbul voices and pick one. |
| `src/lib/speech.ts` | Web Speech API layer, dictation and read-aloud hooks. Feature-detects; the app works fully without either. |
| `src/lib/speech-text.ts` | Pure sentence-chunking and speech-sanitising helpers, kept testable. |
| `src/lib/storage.ts` | Session and profile persistence. Currently the browser; swap the bodies for API calls in Phase 5. |
| `src/components/onboarding/` | Trust + consent screen, then setup. |
| `src/components/advisor/` | Message bubbles and the composer, used by the coach panel. |

## Phase status

- **Phase 1. Advisor core.** Done. Onboarding, the three modes, multi-turn
  streaming advice, sessions saved and resumed.
- **Phase 2. Voice.** Done. Mic in the composer (`SpeechRecognition`, `en-IN`,
  live interim text), and the advisor reads replies aloud sentence-by-sentence as
  they stream (`speechSynthesis`). Both feature-detected; Firefox gets typing and
  no mic, with no broken UI. Toggle read-aloud from the thread header.
- **Phase 3. Roleplay.** Done. Tap "Practise this out loud" in the thread and the
  app casts a counterpart from the conversation, plays it in character turn by turn
  (voice included), and debriefs on "End" with a score, what worked, what to
  sharpen and a stronger line. Inline in the thread, with full screen. The ambient
  nudge toggle is built and persisted; it stays dark until Phase 4 feeds it signals.
- **Phase 4. Delivery signals.** Done. Opt-in camera during roleplay reads face
  and pose with MediaPipe, entirely in the browser. The camera self-view is the
  practice screen: a large mirrored video with three debounced status pills over
  it (eye contact, open posture, steady), the counterpart's current line beneath,
  and the debrief afterwards getting a per-turn summary and a small-multiples
  timeline.
- **The room.** The app is a video call: an icon rail on the left, the user's own
  camera filling the middle with the call controls over it, and the coach on the
  right carrying both the advice and the roleplay turns. Modes are a selector at
  the top of that panel rather than separate screens.
- **Phase 5. History, progress, privacy controls.** Done. Nav across coach,
  history, progress and data. Reopen or delete any past conversation, see scores
  over time and averaged delivery, download everything as JSON, wipe the lot.
  Privacy notice at `/privacy`, with consent versioned so a changed policy re-asks.

## Delivery signals

Everything runs locally. `scripts/setup-mediapipe.mjs` copies MediaPipe's WASM out
of `node_modules` and downloads the two `.task` models into `public/mediapipe/`, so
the browser fetches them from this app's own origin, no CDN, no Google request at
runtime, and it works offline. Those files are generated and gitignored; `npm run
dev` and `npm run build` regenerate them, and if the download fails the app still
runs, just without signals.

The camera and the analysis are separate. The room opens with the camera on, the
way a call does, but the models aren't even fetched until a rehearsal starts:
reading body language while someone types a question to a coach measures nothing,
and 9MB of models is a lot to spend on that. Switching the camera off stops the
read, and it does not restart mid-rehearsal, so a summary is never stitched
together from two halves of a session.

Face runs at ~15Hz and pose on alternate detections (~7.5Hz), which is where the
cost is and where nothing moves fast enough to need more. Captured: whether the
head is pointed at the camera (from the facial transformation matrix, |yaw| < 18
deg and |pitch| < 14 deg), the four paired blendshapes, shoulder width and tilt,
and nose travel over a rolling second. Shoulder width is scored against the
user's own opening seconds, because the absolute number just says how far they're
sitting from the laptop. Nose travel is normalised to a nominal 100ms step, so
changing the detection rate doesn't silently move every threshold built on it.

Two things come out, and the difference is the whole design. `read` is three
debounced good/attention statuses shown live over the camera: two words and a
coloured dot, so the user can see their own signals without being coached at.
A status only flips after the condition has held for 800ms in either direction,
which is what stops the pills strobing and turning into the mid-roleplay
interruption the brief forbids. `samples` is the full timeline, and nobody sees
it until the roleplay is over.

Raw samples never leave the browser. `/api/debrief` receives a text rollup; a 1Hz
downsample is kept for the chart.

## Before this can launch

The privacy notice at `/privacy` carries a visible pre-launch banner because it is
honest about the app but is **not** a compliant DPDP notice yet. Three things are
outstanding and none of them are code:

1. Fill in the operator legal entity and a named grievance officer with contact
   details, then have the notice reviewed by a lawyer.
2. Decide what to do about under-18s. The DPDP Act requires verifiable parental
   consent for children, and the target market is college students, some of whom
   are 17. The notice currently says not to use the app under 18, which is a
   stopgap, not a solution.
3. Confirm the cross-border position on sending conversation text to Anthropic's
   API, which is the only user content that leaves the device.

Remove the banner when those are done, and bump `CONSENT_VERSION` in `storage.ts`
so existing users are asked again.

## Rules that are load-bearing

- The API key is server-side only. Nothing under `src/lib/anthropic.ts` may be
  imported from a `"use client"` component.
- Colours live in `globals.css` as tokens. The only exception is `themeColor` in
  `layout.tsx`, which browser chrome requires as a literal.
- One coral action per screen. Everything else is quiet.
- Signals are physical, never emotional. `signals-math.ts` emits positions and
  movement with no interpretation, and the debrief prompt forbids naming an
  emotion. There is a test asserting no emotion words appear in the summary.
- The debrief verdict describes the attempt, never the person. Social mode also
  scores generously, a harsh number there just confirms what the user already
  fears. Both rules exist because the model produced "Disengaged and unhelpful",
  score 3, for a nervous student's first practice run.
- The ambient dot renders only when the camera is genuinely producing signals.
  A dot with nothing behind it is a fabricated cue.
- Every promise on the trust screen has a control behind it. "You can delete any
  of it, any time" is only true because `Your data` and the per-session delete in
  History exist, don't ship a promise without its button.
- Deleting the open conversation replaces it with a fresh one. Without that, the
  next message saves it straight back into history.
- The counterpart never coaches mid-roleplay, even when the user asks it to
  directly. That instruction is in `roleplaySystemPrompt` and it is tested, it
  was added because the model complied with the user over the system prompt on
  the first attempt. Don't soften it.
- Voice output degrades, it never disappears. No Sarvam key, dead network, spent
  credits or a refused autoplay all fall through to `speechSynthesis` for that
  sentence rather than dropping it.
- Speech-to-text is the browser's, not ours, and on most browsers the audio goes
  to the browser vendor. The trust screen and setup say so, don't quietly drop
  that copy. Moving to Deepgram/Whisper would change what we can promise here.
