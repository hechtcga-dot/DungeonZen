// Hand-drawn decorative props for the desk. All are decorative: aria-hidden,
// no pointer events. Drawn in code so there are no image licences to manage;
// painted art can replace them later without touching the screens.

import type { CSSProperties } from 'react'

type PropProps = { className?: string; style?: CSSProperties }

export function Candle({ className, style }: PropProps) {
  return (
    <div className={`prop candle ${className ?? ''}`} style={style} aria-hidden="true">
      <div className="candle-glow" />
      <svg viewBox="0 0 80 150" width="80" height="150">
        <defs>
          <radialGradient id="flame" cx="50%" cy="70%" r="60%">
            <stop offset="0%" stopColor="#fff8d6" />
            <stop offset="45%" stopColor="#ffd25e" />
            <stop offset="100%" stopColor="#ff7a1a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="wax" x1="0" x2="1">
            <stop offset="0%" stopColor="#d9c9a3" />
            <stop offset="45%" stopColor="#f6ecd2" />
            <stop offset="100%" stopColor="#b9a67c" />
          </linearGradient>
          <linearGradient id="brass" x1="0" x2="1">
            <stop offset="0%" stopColor="#6b4a1c" />
            <stop offset="40%" stopColor="#d9a84e" />
            <stop offset="70%" stopColor="#f3d08a" />
            <stop offset="100%" stopColor="#7a5520" />
          </linearGradient>
        </defs>
        <g className="flame">
          <path d="M40 8 C50 26 52 36 46 46 C43 51 37 51 34 46 C28 36 31 24 40 8 Z" fill="url(#flame)" />
          <path d="M40 26 C44 34 44 40 41 44 C39 46 37 45 36 42 C35 37 37 32 40 26 Z" fill="#fffbe8" opacity="0.9" />
        </g>
        <line x1="40" y1="44" x2="40" y2="54" stroke="#2b1d10" strokeWidth="2" />
        <path d="M24 54 Q40 50 56 54 L56 118 L24 118 Z" fill="url(#wax)" />
        <path d="M30 54 Q31 66 28 74 Q26 80 29 84" fill="none" stroke="#efe2c2" strokeWidth="4" strokeLinecap="round" />
        <path d="M50 54 Q51 62 53 66" fill="none" stroke="#e6d6b0" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="40" cy="122" rx="34" ry="9" fill="#3a2610" opacity="0.5" />
        <path d="M8 118 Q40 108 72 118 Q72 128 40 132 Q8 128 8 118 Z" fill="url(#brass)" />
        <path d="M16 118 Q40 112 64 118" fill="none" stroke="#fbe3a6" strokeWidth="1.5" opacity="0.7" />
      </svg>
    </div>
  )
}

export function D20({ className, style }: PropProps) {
  return (
    <svg className={`prop ${className ?? ''}`} style={style} viewBox="0 0 100 100" width="84" height="84" aria-hidden="true">
      <defs>
        <linearGradient id="d20a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4433a" />
          <stop offset="100%" stopColor="#5e1612" />
        </linearGradient>
      </defs>
      <polygon points="50,4 92,28 92,72 50,96 8,72 8,28" fill="url(#d20a)" stroke="#2b0a08" strokeWidth="2" />
      <polygon points="50,22 76,64 24,64" fill="#a8322a" stroke="#f0c4a0" strokeWidth="1.2" strokeOpacity="0.6" />
      <g stroke="#f0c4a0" strokeOpacity="0.45" strokeWidth="1.2" fill="none">
        <path d="M50 4 L50 22 M8 28 L50 22 L92 28 M8 28 L24 64 M92 28 L76 64 M8 72 L24 64 L50 96 L76 64 L92 72" />
      </g>
      <text x="50" y="56" textAnchor="middle" fontFamily="'IM Fell English', serif" fontSize="18" fill="#fbe7c6">20</text>
    </svg>
  )
}

export function Potion({ className, style }: PropProps) {
  return (
    <svg className={`prop ${className ?? ''}`} style={style} viewBox="0 0 80 120" width="70" height="105" aria-hidden="true">
      <defs>
        <radialGradient id="liquid" cx="40%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#ff6b7d" />
          <stop offset="70%" stopColor="#9a1a33" />
          <stop offset="100%" stopColor="#4a0818" />
        </radialGradient>
      </defs>
      <rect x="31" y="6" width="18" height="12" rx="3" fill="#8a5a2b" stroke="#3b2410" />
      <path d="M33 18 L47 18 L47 34 C64 42 72 58 70 76 C68 98 52 112 40 112 C28 112 12 98 10 76 C8 58 16 42 33 34 Z"
        fill="#cfe6e8" fillOpacity="0.25" stroke="#e6f3f3" strokeOpacity="0.7" strokeWidth="2" />
      <path d="M13 70 C20 64 60 64 67 70 C68 96 52 108 40 108 C28 108 12 96 13 70 Z" fill="url(#liquid)" />
      <ellipse cx="28" cy="58" rx="5" ry="12" fill="#fff" opacity="0.35" transform="rotate(20 28 58)" />
      <circle cx="50" cy="86" r="3" fill="#ffd0d6" opacity="0.6" />
      <circle cx="34" cy="94" r="2" fill="#ffd0d6" opacity="0.5" />
    </svg>
  )
}

export function Leaf({ className, style, colour = '#b5462a' }: PropProps & { colour?: string }) {
  return (
    <svg className={`prop ${className ?? ''}`} style={style} viewBox="0 0 100 100" width="90" height="90" aria-hidden="true">
      <path d="M50 92 L50 60 M50 60 C30 66 12 56 8 40 C22 42 26 34 22 22 C34 28 40 22 42 8 C48 18 52 18 58 8 C60 22 66 28 78 22 C74 34 78 42 92 40 C88 56 70 66 50 60 Z"
        fill={colour} stroke="#3d160c" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M50 60 L50 20 M50 44 L30 32 M50 44 L70 32 M50 54 L22 44 M50 54 L78 44" stroke="#3d160c" strokeWidth="1" opacity="0.6" fill="none" />
    </svg>
  )
}

export function Quill({ className, style }: PropProps) {
  return (
    <svg className={`prop ${className ?? ''}`} style={style} viewBox="0 0 200 60" width="200" height="60" aria-hidden="true">
      <path d="M10 50 C60 40 120 14 190 6 C160 20 130 30 90 40 C60 46 30 50 10 50 Z" fill="#efe6d2" stroke="#6b5a3e" strokeWidth="1.2" />
      <path d="M10 50 C70 38 130 18 190 6" stroke="#6b5a3e" strokeWidth="1.2" fill="none" />
      <g stroke="#b9a988" strokeWidth="0.8">
        {Array.from({ length: 14 }, (_, i) => {
          const x = 40 + i * 10
          return <path key={i} d={`M${x} ${46 - i * 2.6} l8 -6`} />
        })}
      </g>
      <path d="M4 52 L12 49" stroke="#1d150c" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function CompassRose({ className, style }: PropProps) {
  return (
    <svg className={`prop ${className ?? ''}`} style={style} viewBox="0 0 100 100" width="96" height="96" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="#5a4a32" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="#5a4a32" strokeWidth="0.8" strokeDasharray="2 3" />
      <g fill="#8f2a21" stroke="#2a1f12" strokeWidth="0.8">
        <polygon points="50,6 55,50 50,46 45,50" />
        <polygon points="50,94 55,50 50,54 45,50" fill="#e8d9b0" />
        <polygon points="6,50 50,45 46,50 50,55" fill="#e8d9b0" />
        <polygon points="94,50 50,45 54,50 50,55" fill="#e8d9b0" />
      </g>
      <g fill="#c9b07a" stroke="#2a1f12" strokeWidth="0.6" opacity="0.9">
        <polygon points="22,22 52,48 48,52" /><polygon points="78,22 48,48 52,52" />
        <polygon points="22,78 52,52 48,48" /><polygon points="78,78 48,52 52,48" />
      </g>
      <circle cx="50" cy="50" r="4" fill="#2a1f12" />
      <text x="50" y="5" textAnchor="middle" fontFamily="'IM Fell English', serif" fontSize="9" fill="#2a1f12" dy="-0.5">N</text>
    </svg>
  )
}
