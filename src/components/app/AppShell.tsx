"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/lib/theme";

export type View = "advisor" | "history" | "progress" | "data";

/**
 * The room's chrome: a narrow icon rail on the left, the room itself filling
 * everything else. On a phone the rail becomes a bottom bar, because a 64px
 * column on a 390px screen is a quarter of the width spent on navigation.
 *
 * Active is coral, everything else is muted. Labels appear on hover on desktop
 * and are always available to a screen reader.
 */

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M9.5 20.5V14h5v6.5" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5Z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

function CoachIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <rect x="2.5" y="6" width="13" height="12" rx="3" stroke="currentColor" />
      <path d="M15.5 11l6-3.5v9l-6-3.5z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <path d="M4 19V10M10 19V5M16 19v-6M22 19H2" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" />
      <path d="M5 19.5c1.2-3.2 3.9-5 7-5s5.8 1.8 7 5" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

const NAV: { id: View; label: string; icon: () => ReactNode }[] = [
  { id: "advisor", label: "Coach", icon: CoachIcon },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "progress", label: "Progress", icon: ProgressIcon },
];

const PROFILE: { id: View; label: string; icon: () => ReactNode } = {
  id: "data",
  label: "You and your data",
  icon: ProfileIcon,
};

function NavButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={[
        "group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
        active ? "bg-coral/12 text-coral" : "text-ink-3 hover:bg-fill hover:text-ink-2",
      ].join(" ")}
    >
      {children}
      {/* Desktop only: the rail has no room for labels, so they arrive on hover. */}
      <span className="pointer-events-none absolute left-full z-30 ml-2 hidden whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-medium text-page opacity-0 transition-opacity group-hover:opacity-100 md:block">
        {label}
      </span>
    </button>
  );
}

export default function AppShell({
  view,
  onChange,
  onHome,
  atHome,
  children,
}: {
  view: View;
  onChange: (v: View) => void;
  /** Back to the doorway. Leaving the room unmounts it, which stops the camera. */
  onHome: () => void;
  /** True when the doorway is what's on screen, so the rail says where you are. */
  atHome: boolean;
  children: ReactNode;
}) {
  const homeActive = atHome && view === "advisor";
  const items = [...NAV, PROFILE];
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* Desktop rail */}
      <nav
        aria-label="Sections"
        className="hidden shrink-0 flex-col items-center gap-1 border-r bg-card px-2.5 py-4 hairline md:flex md:w-16"
      >
        <span
          aria-hidden
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-coral text-sm font-semibold text-on-accent"
          title="PrepRoom"
        >
          P
        </span>
        <NavButton label="Home" active={homeActive} onClick={onHome}>
          <HomeIcon />
        </NavButton>
        {NAV.map((item) => (
          <NavButton
            key={item.id}
            label={item.label}
            active={view === item.id && !(item.id === "advisor" && homeActive)}
            onClick={() => onChange(item.id)}
          >
            <item.icon />
          </NavButton>
        ))}
        <div className="mt-auto flex flex-col items-center gap-1">
          {/* Not navigation, so it never reads as active. It's the one switch
              between the two palettes, and light is where it starts. */}
          <NavButton
            label={dark ? "Switch to light" : "Switch to dark"}
            active={false}
            onClick={toggle}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </NavButton>
          <NavButton
            label={PROFILE.label}
            active={view === PROFILE.id}
            onClick={() => onChange(PROFILE.id)}
          >
            <PROFILE.icon />
          </NavButton>
        </div>
      </nav>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>

      {/* Mobile bar */}
      <nav
        aria-label="Sections"
        className="flex shrink-0 items-center justify-around border-t bg-card px-2 py-1.5 hairline md:hidden"
      >
        <button
          type="button"
          onClick={onHome}
          aria-current={homeActive ? "page" : undefined}
          aria-label="Home"
          className={[
            "flex h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
            homeActive ? "bg-coral/12 text-coral" : "text-ink-3",
          ].join(" ")}
        >
          <HomeIcon />
        </button>
        {items.map((item) => {
          const active = view === item.id && !(item.id === "advisor" && homeActive);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={[
                "flex h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
                active ? "bg-coral/12 text-coral" : "text-ink-3",
              ].join(" ")}
            >
              <item.icon />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
