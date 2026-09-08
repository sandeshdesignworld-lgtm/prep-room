import Image from "next/image";

/**
 * The Prime AI mark: a speaking head with the coral waves.
 *
 * Two files rather than one, because the artwork is line work with no fill.
 * Black strokes vanish on the dark theme and pale strokes vanish on the light
 * one, so each theme gets the drawing in its own ink and CSS picks. Both are
 * fetched, which is a few kilobytes, and that is cheaper than the flash of a
 * swap after the theme class lands.
 */
export default function BrandMark({
  size,
  className = "",
}: {
  /** Rendered edge length in pixels. The source is 256, so stay under it. */
  size: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    // Decorative in every place it is used: the name is always beside it in
    // text, so a screen reader announcing "Prime AI logo" would just repeat.
    "aria-hidden": true as const,
    priority: true,
  };
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <Image {...common} alt="" src="/icons/mark-light.png" className="dark:hidden" />
      <Image {...common} alt="" src="/icons/mark-dark.png" className="hidden dark:block" />
    </span>
  );
}
