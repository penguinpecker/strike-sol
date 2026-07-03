// Inline SVGs reused across STRIKE (brand mark, 𝕏 logo, call arrows, nav glyphs).

export const BrandMark = ({ size = 24 }: { size?: number }) => (
  <svg viewBox="0 0 28 28" width={size} height={size}>
    <circle cx="14" cy="14" r="14" fill="#AB9FF2" />
    <path
      d="M14 5.6C10.6 8.1 10.6 11 14 13.4C17.4 15.8 17.4 18.7 14 21.2M14 5.6C17.4 8.1 17.4 11 14 13.4C10.6 15.8 10.6 18.7 14 21.2"
      fill="none"
      stroke="#15142B"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    <circle cx="14" cy="13.4" r="1.7" fill="#15142B" />
  </svg>
);

export const XLogo = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 6-7Zm-1.3 19.4h2L6.6 3.3h-2.2l13.2 17.3Z" />
  </svg>
);

export const ArrowDownGlyph = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round">
    <path d="M50 16 V80 M50 82 L26 58 M50 82 L74 58" />
  </svg>
);

export const ArrowUpGlyph = () => (
  <svg viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round">
    <path d="M50 84 V20 M50 18 L26 42 M50 18 L74 42" />
  </svg>
);

export const NavCall = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
    <path d="M12 19V6M12 5l-5.5 5.5M12 5l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const NavFeed = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M4 6h16M4 12h11M4 18h7" strokeLinecap="round" />
  </svg>
);
export const NavRanks = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M5 21V10m7 11V4m7 17v-7" strokeLinecap="round" />
  </svg>
);
export const NavYou = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
  </svg>
);
