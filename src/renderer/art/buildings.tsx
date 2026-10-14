// Backdrops for building sheets, drawn in code (replaceable by painted art later):
// a lamp-lit taproom for taverns, a smith's wall of blades for shops, a street front otherwise.

import type { BuildingKind } from '../../shared/building'

function Tavern() {
  return (
    <>
      <defs>
        <radialGradient id="bd-fire" cx="78%" cy="85%" r="45%"><stop offset="0" stopColor="#ffb347" stopOpacity=".9" /><stop offset=".4" stopColor="#c2531b" stopOpacity=".55" /><stop offset="1" stopColor="#1a0d05" stopOpacity="0" /></radialGradient>
        <linearGradient id="bd-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a170a" /><stop offset="1" stopColor="#4a2a14" /></linearGradient>
        <radialGradient id="bd-lamp"><stop offset="0" stopColor="#ffe7a0" /><stop offset=".3" stopColor="#ffb84a" stopOpacity=".6" /><stop offset="1" stopColor="#ffb84a" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1400" height="190" fill="url(#bd-wall)" />
      <g stroke="#160b04" strokeWidth="2" fill="#3a2110"><rect x="0" y="0" width="1400" height="26" /><rect x="180" y="0" width="22" height="190" /><rect x="560" y="0" width="22" height="190" /><rect x="940" y="0" width="22" height="190" /></g>
      <g fill="#5a3a1e" stroke="#1a0d05"><rect x="1020" y="90" width="150" height="100" /><rect x="1035" y="110" width="120" height="80" fill="#140803" /></g>
      <rect width="1400" height="190" fill="url(#bd-fire)" />
      <path d="M1060 190 q15 -50 30 -10 q10 -40 25 0 q12 -35 22 10z" fill="#ffb347" />
      <rect x="250" y="120" width="600" height="70" fill="#5c3518" stroke="#1a0d05" strokeWidth="2" /><rect x="240" y="114" width="620" height="10" fill="#7a4a22" />
      <g fill="#c8a25a" stroke="#3b2608"><rect x="300" y="96" width="16" height="20" rx="2" /><rect x="340" y="98" width="14" height="18" rx="2" /><rect x="620" y="96" width="16" height="20" rx="2" /><rect x="760" y="97" width="15" height="19" rx="2" /></g>
      <g fill="#6a3c1a" stroke="#1a0d05"><ellipse cx="420" cy="75" rx="34" ry="26" /><ellipse cx="500" cy="75" rx="34" ry="26" /><ellipse cx="460" cy="40" rx="34" ry="26" /></g>
      <line x1="120" y1="26" x2="120" y2="70" stroke="#111" /><circle cx="120" cy="80" r="60" fill="url(#bd-lamp)" /><rect x="112" y="70" width="16" height="20" fill="#ffd57a" stroke="#2a1806" />
      <line x1="720" y1="26" x2="720" y2="60" stroke="#111" /><circle cx="720" cy="70" r="55" fill="url(#bd-lamp)" /><rect x="712" y="60" width="16" height="20" fill="#ffd57a" stroke="#2a1806" />
    </>
  )
}

function Shop() {
  const blade = (x: number, w: number, h: number) => (
    <g transform={`translate(${x},40)`}><rect x={-w / 2} y="0" width={w} height={h} fill="url(#bd-steel)" /><rect x={-w * 2} y={h} width={w * 4} height="5" fill="#b58a3a" /><rect x="-3" y={h + 5} width="6" height="14" fill="#3a2110" /></g>
  )
  return (
    <>
      <defs>
        <linearGradient id="bd-stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#262321" /><stop offset="1" stopColor="#3d3530" /></linearGradient>
        <radialGradient id="bd-forge" cx="12%" cy="90%" r="40%"><stop offset="0" stopColor="#ff8a2a" stopOpacity=".85" /><stop offset=".5" stopColor="#a33a12" stopOpacity=".4" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <linearGradient id="bd-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8d949a" /><stop offset=".5" stopColor="#e3e7ea" /><stop offset="1" stopColor="#7c8389" /></linearGradient>
      </defs>
      <rect width="1400" height="190" fill="url(#bd-stone)" />
      <path d="M0 40h1400M0 80h1400M0 120h1400M0 160h1400" stroke="#1a1714" opacity=".6" />
      <rect width="1400" height="190" fill="url(#bd-forge)" />
      <path d="M90 190 l20 -40 h80 l20 40z" fill="#2b2420" />
      <rect x="320" y="30" width="420" height="12" fill="#5a3a1e" stroke="#1a0d05" /><rect x="320" y="150" width="420" height="12" fill="#5a3a1e" stroke="#1a0d05" />
      {blade(360, 6, 96)}{blade(410, 8, 90)}{blade(600, 6, 96)}
      <g transform="translate(470,42)"><rect x="-2" y="0" width="4" height="108" fill="#6b4a26" /><path d="M2 8 q30 10 26 30 q-4 18 -26 22z" fill="url(#bd-steel)" /></g>
      <g transform="translate(530,42)"><rect x="-2" y="0" width="4" height="108" fill="#6b4a26" /><path d="M0 -14 l-6 18 h12z" fill="url(#bd-steel)" /></g>
      <path d="M680 40 q-40 55 0 110" stroke="#6b4a26" strokeWidth="5" fill="none" /><path d="M680 40 L680 150" stroke="#ddd" />
      <g transform="translate(880,95)"><path d="M-45 -50 h90 v40 q0 45 -45 60 q-45 -15 -45 -60z" fill="#7a2a1e" stroke="#c8a25a" strokeWidth="4" /><path d="M0 -40 v80 M-35 -10 h70" stroke="#c8a25a" strokeWidth="5" /></g>
      <g transform="translate(1010,95)"><circle r="48" fill="#4a5560" stroke="#a9b2ba" strokeWidth="5" /><circle r="12" fill="#c8a25a" /></g>
      <g transform="translate(1180,150)"><path d="M-70 0 h140 l-20 -26 h-100z" fill="#4e4945" stroke="#111" /><rect x="-20" y="0" width="40" height="40" fill="#3a3531" /></g>
    </>
  )
}

function Street() {
  return (
    <>
      <defs><linearGradient id="bd-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b4a5a" /><stop offset="1" stopColor="#c9a46a" /></linearGradient></defs>
      <rect width="1400" height="190" fill="url(#bd-sky)" />
      {[[80, 70, 180], [300, 40, 220], [560, 60, 200], [800, 30, 260], [1100, 55, 220]].map(([x, y, w], i) => (
        <g key={i}>
          <path d={`M${x} 190 V${y + 40} L${x + w / 2} ${y} L${x + w} ${y + 40} V190 Z`} fill={i % 2 ? '#5c6b73' : '#6e5a44'} stroke="#1f1a14" strokeWidth="2" />
          <rect x={x + w / 2 - 18} y="140" width="36" height="50" fill="#2a1f12" />
          <rect x={x + 24} y={y + 60} width="28" height="30" fill="#f0c24a" opacity=".85" /><rect x={x + w - 52} y={y + 60} width="28" height="30" fill="#f0c24a" opacity=".85" />
        </g>
      ))}
      <rect y="182" width="1400" height="8" fill="#3a2f22" />
    </>
  )
}

export function BuildingBackdrop({ kind, title, sub }: { kind: BuildingKind; title: React.ReactNode; sub: string }) {
  return (
    <div className="building-backdrop">
      <svg viewBox="0 0 1400 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {kind === 'tavern' ? <Tavern /> : kind === 'shop' ? <Shop /> : <Street />}
      </svg>
      <div className="building-backdrop-cap">{title}<small>{sub}</small></div>
    </div>
  )
}
