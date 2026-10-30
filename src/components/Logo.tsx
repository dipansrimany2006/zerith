/** Zerith mark: an eye inside viewfinder corners. Drawn in currentColor; the pupil uses `pupil`. */
export function ZerithMark({ className, pupil = 'var(--ink)' }: { className?: string; pupil?: string }) {
  return (
    <svg viewBox="128 128 244 244" fill="none" className={className} aria-hidden>
      <path
        d="M144 178v-36h36M356 178v-36h-36M144 322v36h36M356 322v36h-36"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="square"
      />
      <path d="M162 250C205 190 300 190 343 250C300 310 205 310 162 250Z" fill="currentColor" />
      <ellipse cx="251" cy="250" rx="40" ry="41" fill={pupil} />
    </svg>
  )
}
