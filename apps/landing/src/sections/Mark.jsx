// The CCD isoline mark: three contours of one crowd hill, offset toward the side it presses on, with an
// amber peak. Identical geometry to the dashboard's mark.
export default function Mark({ size = 30 }) {
  return (
    <svg aria-hidden="true" className="mark" fill="none" height={size} viewBox="0 0 32 32" width={size}>
      <path d="M16 2.5c7.9 0 13.5 5.2 13.5 12.6 0 7.9-6.3 14.4-14.2 14.4C8 29.5 2.5 24 2.5 16.6 2.5 8.6 8.4 2.5 16 2.5Z" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" />
      <path d="M17.2 7.4c5 0 8.3 3.4 8.3 8.1 0 5.1-3.8 9.2-8.8 9.2-4.7 0-8-3.4-8-8.1 0-5.2 3.6-9.2 8.5-9.2Z" stroke="currentColor" strokeOpacity=".8" strokeWidth="1.5" />
      <path d="M18.6 12.3c2.4 0 4 1.6 4 3.9 0 2.5-1.9 4.5-4.3 4.5-2.3 0-3.9-1.7-3.9-4 0-2.5 1.8-4.4 4.2-4.4Z" fill="var(--accent)" />
    </svg>
  );
}
