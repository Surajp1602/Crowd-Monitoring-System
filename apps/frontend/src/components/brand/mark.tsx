import { cn } from "@/lib/utils";

/**
 * The CCD mark: three isolines of a single crowd "hill", offset the way density
 * contours bunch on the side a crowd is pressing toward. The inner ring is amber,
 * the one accent, marking the peak.
 */
export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M16 2.5c7.9 0 13.5 5.2 13.5 12.6 0 7.9-6.3 14.4-14.2 14.4C8 29.5 2.5 24 2.5 16.6 2.5 8.6 8.4 2.5 16 2.5Z"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      <path
        d="M17.2 7.4c5 0 8.3 3.4 8.3 8.1 0 5.1-3.8 9.2-8.8 9.2-4.7 0-8-3.4-8-8.1 0-5.2 3.6-9.2 8.5-9.2Z"
        stroke="currentColor"
        strokeOpacity="0.8"
        strokeWidth="1.5"
      />
      <path
        d="M18.6 12.3c2.4 0 4 1.6 4 3.9 0 2.5-1.9 4.5-4.3 4.5-2.3 0-3.9-1.7-3.9-4 0-2.5 1.8-4.4 4.2-4.4Z"
        fill="var(--amber)"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark className="text-paper" />
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-[-0.01em] text-paper">CCD</span>
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-paper-faint">
          Crowd density
        </span>
      </span>
    </span>
  );
}
