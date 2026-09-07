import type { ReactNode } from "react";

export default function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        {optional && <span className="text-xs text-ink-3">optional</span>}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-ink-2">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border bg-card hairline px-3.5 py-2.5 text-sm text-ink " +
  "placeholder:text-ink-3 resize-none";
