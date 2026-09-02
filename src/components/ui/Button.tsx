"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  // Poppy is the one loud thing on a screen. Never put two of these side by side.
  primary: "bg-poppy text-white hover:bg-poppy-hover active:bg-poppy-hover shadow-sm",
  secondary: "bg-card text-ink hairline border hover:bg-fill-2",
  ghost: "text-ink-2 hover:text-ink hover:bg-fill-2",
  danger: "bg-brick text-white hover:opacity-90",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
}

export default function Button({
  variant = "primary",
  full = false,
  className = "",
  ...props
}: Props) {
  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5",
        "text-sm font-medium transition-colors",
        "disabled:opacity-45 disabled:pointer-events-none",
        VARIANTS[variant],
        full ? "w-full" : "",
        className,
      ].join(" ")}
    />
  );
}
