import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | PrepRoom",
  description: "What PrepRoom stores, what it never stores, and what you can do about it.",
};

const UPDATED = "2 September 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-dusty">PrepRoom</p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Privacy</h1>
      <p className="mt-2 text-sm text-ink-2">Last updated {UPDATED}.</p>

      <div className="mt-6 rounded-2xl border border-poppy/40 bg-poppy/8 p-4">
        <p className="text-sm leading-relaxed text-ink">
          <strong className="font-semibold">Pre-launch draft.</strong> This is written to be
          accurate about what the app currently does, but it has not been reviewed by a lawyer and
          the operator details below are unfilled. It is not yet a compliant notice under India&apos;s
          Digital Personal Data Protection Act, and must be completed and reviewed before PrepRoom
          is offered to real users.
        </p>
      </div>

      <Section title="The short version">
        <p>
          PrepRoom stores your conversations in your own browser. Your camera and your voice never
          leave your device. The one thing that does leave is the text of your conversation with the
          coach, which has to be sent to an AI provider to get a reply. You can download everything
          we hold, or delete it, at any time, from the &ldquo;Your data&rdquo; screen.
        </p>
      </Section>

      <Section title="What we collect, and why">
        <p>
          <strong className="font-medium text-ink">What you tell the coach.</strong> The messages you
          type or dictate, and the replies. Used to give you advice and to let you reopen a past
          conversation.
        </p>
        <p>
          <strong className="font-medium text-ink">Your setup answers.</strong> The mode you chose, a
          few lines about yourself, and what you wanted out of it. Used to make the advice specific
          to you.
        </p>
        <p>
          <strong className="font-medium text-ink">Practice notes.</strong> Roleplay transcripts,
          scores and debriefs. Used to show you your progress.
        </p>
        <p>
          <strong className="font-medium text-ink">Delivery signals, only if you switch the camera
          on.</strong> Numbers describing physical position and movement: whether your head was
          pointed at the screen, how much it moved, how square your shoulders were, and a set of
          facial-muscle measurements. These are computed from the camera inside your browser. They
          describe your body, not your feelings, and nothing here diagnoses or assesses you.
        </p>
      </Section>

      <Section title="What we never collect">
        <p>
          <strong className="font-medium text-ink">No video.</strong> When the camera is on, frames
          are analysed in your browser by software served from this app and discarded immediately.
          No frame is recorded, uploaded, or transmitted.
        </p>
        <p>
          <strong className="font-medium text-ink">No audio recordings.</strong> When you dictate,
          your browser&apos;s own speech-to-text turns speech into text. We receive only the text.
          Note that most browsers do this by sending the audio to the browser vendor&apos;s servers, that is between you and your browser, and typing avoids it entirely.
        </p>
        <p>
          <strong className="font-medium text-ink">No selling, sharing, or training.</strong> Your
          sessions are never sold, shared with third parties for their own purposes, or used to
          train any AI model.
        </p>
      </Section>

      <Section title="Where your data actually sits">
        <p>
          Today, everything is held in your browser&apos;s local storage on the device you are using.
          There is no account and no copy on our servers. If you clear your browser data, or use the
          delete controls in the app, it is gone. We cannot restore it, because we never had it.
        </p>
        <p>
          The consequence: your history does not follow you to another device or another browser.
        </p>
      </Section>

      <Section title="The one thing that leaves your device">
        <p>
          To answer you, the app sends the text of your conversation to Anthropic&apos;s API, which
          generates the coach&apos;s reply. That means your conversation text is processed on
          servers outside India. Anthropic does not use API inputs or outputs to train its models.
          Nothing else is sent anywhere: no video, no audio, and no delivery signals beyond a short
          written summary used to write your debrief.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can see everything held about you, take a copy of it as a JSON file, and delete any
          single conversation or all of it, from the &ldquo;Your data&rdquo; screen inside the app.
          You do not need to ask us, and you do not need a reason.
        </p>
        <p>
          You can withdraw your consent at any time by deleting everything, which returns the app to
          its first-run state.
        </p>
      </Section>

      <Section title="Age">
        <p>
          PrepRoom is built for college students and early-career adults. Indian data protection law
          gives people under 18 additional protections, including a requirement for verifiable
          parental consent. PrepRoom does not currently verify age or obtain parental consent, so it
          should not be used by anyone under 18 until that is built.
        </p>
      </Section>

      <Section title="This is not therapy">
        <p>
          PrepRoom is a practice aid for communication. It is not therapy, counselling, medical
          advice, or a diagnosis, and the delivery signals are physical measurements rather than any
          assessment of your mental state. If something heavier is going on, please talk to someone
          you trust or a qualified professional.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Operator: <span className="text-ink-3">[legal entity name to be added]</span>. Questions or
          complaints about your data: <span className="text-ink-3">[grievance officer name and
          email to be added]</span>. Under the DPDP Act you may escalate an unresolved complaint to
          the Data Protection Board of India.
        </p>
      </Section>

      <p className="mt-10 text-sm">
        <Link href="/" className="text-dusty underline underline-offset-2">
          Back to PrepRoom
        </Link>
      </p>
    </main>
  );
}
