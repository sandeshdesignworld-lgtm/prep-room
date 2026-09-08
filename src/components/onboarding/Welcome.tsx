"use client";

import Button from "@/components/ui/Button";
import BrandMark from "@/components/app/BrandMark";

const PROMISES = [
  {
    title: "Your camera never leaves your device",
    body: "The room opens with your camera on, like any call, and you can switch it off at any point. It's read entirely inside your browser, the models run on your machine, off files served by this app. No video is recorded, uploaded, or sent anywhere, and your body language is only read while you're rehearsing.",
  },
  {
    title: "We keep the notes, not the recording",
    body: "A transcript, what you were working on, how it went, and (if the camera was on while you rehearsed) a few numbers about where you were looking and how much you moved. That's it.",
  },
  {
    title: "You can delete any of it, any time",
    body: "One conversation or everything at once. Deleted means gone.",
  },
  {
    title: "Nobody else reads your sessions",
    body: "They aren't shared, sold, or used to train anything. What you practise here is yours.",
  },
];

export default function Welcome({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-5 py-12">
      <div className="fade-up">
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-blue-strong">Prime AI</p>
        </div>
        <h1 className="mt-3 text-3xl leading-tight font-semibold text-ink">
          A place to practise the conversation before you have it.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Bring a real situation, an interview, a hard conversation, something small you keep
          avoiding. We&apos;ll work out what to actually say, then you can rehearse it out loud.
        </p>

        <div className="mt-8 rounded-2xl border bg-card hairline p-5">
          <h2 className="text-sm font-semibold text-ink">Before you start, how this works</h2>
          <ul className="mt-4 space-y-4">
            {PROMISES.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{p.title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-2">
          One honest caveat about talking: speech-to-text is done by your browser, not by us,
          and most browsers send that audio to their own servers to transcribe it. Typing avoids
          this entirely, and you can switch at any point.
        </p>

        <p className="mt-4 text-xs leading-relaxed text-ink-2">
          Prime AI is a practice aid for communication, it isn&apos;t therapy, counselling, or a
          diagnosis, and it won&apos;t tell you what&apos;s wrong with you. If something heavier is
          going on, please talk to someone you trust or a professional.
        </p>

        <div className="mt-7">
          <Button full onClick={onAccept}>
            I understand, let&apos;s start
          </Button>
          <p className="mt-3 text-center text-xs text-ink-3">
            Takes about a minute to set up. Read the{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="inline-block py-2 text-blue-strong underline underline-offset-2"
            >
              full privacy policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
