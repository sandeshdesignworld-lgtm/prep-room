"use client";

import type { ReactNode } from "react";

export type View = "advisor" | "history" | "progress" | "data";

const TABS: { id: View; label: string }[] = [
  { id: "advisor", label: "Coach" },
  { id: "history", label: "History" },
  { id: "progress", label: "Progress" },
  { id: "data", label: "Your data" },
];

/**
 * Quiet chrome. The advisor is home, so the nav stays out of the way, no
 * colour, no badges, nothing competing with the one orange action on a screen.
 */
export default function AppShell({
  view,
  onChange,
  children,
}: {
  view: View;
  onChange: (v: View) => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <nav className="sticky top-0 z-20 border-b bg-page/92 hairline backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-1 px-4 py-2">
          <span className="mr-auto text-xs font-medium uppercase tracking-[0.14em] text-dusty">
            PrepRoom
          </span>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={view === tab.id ? "page" : undefined}
              className={[
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === tab.id ? "bg-fill text-ink" : "text-ink-2 hover:bg-fill-2 hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
