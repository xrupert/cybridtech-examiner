export function Logo({ height = 28 }: { height?: number; showWord?: boolean }) {
  const h = height;
  const w = Math.round(h * 3.65);
  return (
    <svg width={w} height={h} viewBox="0 0 520 142" aria-label="CybridTech Solutions" role="img">
      <defs>
        <linearGradient id="orb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7b4dff" />
          <stop offset="100%" stopColor="#2ad4e8" />
        </linearGradient>
        <linearGradient id="word" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6d3cff" />
          <stop offset="100%" stopColor="#1fc4d6" />
        </linearGradient>
      </defs>
      <g transform="translate(8,12)">
        <path d="M78 24c-22 6-38 28-38 52 0 18 8 34 22 44 2-28 18-50 42-62-8-18-16-28-26-34z" fill="#6b3ee8" />
        <path d="M78 30c-18 6-32 24-32 46 0 14 6 28 16 36 3-24 16-44 36-56-6-14-12-22-20-26z" fill="none" stroke="#c4b5fd" strokeWidth="1.2" opacity="0.7" />
        <ellipse cx="86" cy="78" rx="70" ry="26" fill="none" stroke="url(#orb)" strokeWidth="7" transform="rotate(-28 86 78)" />
        <ellipse cx="86" cy="78" rx="70" ry="26" fill="none" stroke="url(#orb)" strokeWidth="7" transform="rotate(38 86 78)" />
      </g>
      <text x="188" y="78" fill="url(#word)" fontFamily="Inter, ui-sans-serif, sans-serif" fontSize="44" fontWeight="600" letterSpacing="1.5">CYBRIDTECH</text>
      <text x="248" y="108" fill="#111" fontFamily="Inter, ui-sans-serif, sans-serif" fontSize="16" fontWeight="500" letterSpacing="6">SOLUTIONS</text>
    </svg>
  );
}
