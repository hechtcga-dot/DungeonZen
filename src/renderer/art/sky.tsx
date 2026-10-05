import { moonOn, skyAt } from '../../shared/sky'
import { formatClock } from '../../shared/time'

/** Brass dial with the sky: the sun or moon travels the arc, the colour follows the light. */
export function ClockDial({ minutes, moonOffsetDays = 0 }: { minutes: number; moonOffsetDays?: number }) {
  const sky = skyAt(minutes)
  const moonLit = moonOn(minutes, moonOffsetDays).illumination
  // Arc from left (180°) to right (0°) over a semicircle of radius 62 centred at (100, 100).
  const angle = Math.PI * (1 - sky.progress)
  const bx = 100 + Math.cos(angle) * 62
  const by = 100 - Math.sin(angle) * 62
  const lightLabel = { night: 'Night', dawn: 'Dawn', daylight: 'Daylight', dusk: 'Dusk' }[sky.light]
  return (
    <svg viewBox="0 0 200 120" className="clock-dial" role="img"
      aria-label={`${formatClock(minutes)}, ${lightLabel.toLowerCase()}, the ${sky.body} is up`}>
      <defs>
        <linearGradient id="skyfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.top} />
          <stop offset="100%" stopColor={sky.bottom} />
        </linearGradient>
        <linearGradient id="dialbrass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3d08a" />
          <stop offset="45%" stopColor="#b5852f" />
          <stop offset="100%" stopColor="#5e3f12" />
        </linearGradient>
        <radialGradient id="sunglow">
          <stop offset="0%" stopColor="#fff6c8" />
          <stop offset="60%" stopColor="#ffd34d" />
          <stop offset="100%" stopColor="#ffb02e" stopOpacity="0" />
        </radialGradient>
        <clipPath id="skyclip"><path d="M24 100 A76 76 0 0 1 176 100 Z" /></clipPath>
      </defs>
      <path d="M14 104 A86 86 0 0 1 186 104 L186 112 L14 112 Z" fill="url(#dialbrass)" stroke="#3b2608" strokeWidth="1.5" />
      <path d="M24 100 A76 76 0 0 1 176 100 Z" fill="url(#skyfill)" stroke="#3b2608" strokeWidth="1.5" />
      <g clipPath="url(#skyclip)">
        {sky.light === 'night' && [[60, 48], [84, 36], [120, 44], [140, 62], [70, 72], [150, 40]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="#fff8e0" />
        ))}
        {sky.body === 'sun'
          ? <><circle cx={bx} cy={by} r="16" fill="url(#sunglow)" /><circle cx={bx} cy={by} r="8" fill="#ffe27a" /></>
          : <><circle cx={bx} cy={by} r="8" fill="#f4f0dc" />
            {moonLit < 0.85 && <circle cx={bx + 3 + moonLit * 6} cy={by - 2} r="7" fill={sky.top} opacity="0.9" />}</>}
        <path d="M24 100 L24 90 L34 90 L34 84 L40 78 L46 84 L46 92 L58 92 L58 80 L64 80 L64 74 L68 70 L72 74 L72 92 L86 92 L86 86 L96 86 L96 92 L110 92 L110 78 L116 72 L122 78 L122 92 L132 92 L132 84 L142 84 L142 76 L146 72 L150 76 L150 92 L162 92 L162 86 L176 86 L176 100 Z" fill="#1d150c" />
      </g>
      {Array.from({ length: 13 }, (_, i) => {
        const a = Math.PI * (1 - i / 12)
        return <line key={i} x1={100 + Math.cos(a) * 78} y1={100 - Math.sin(a) * 78} x2={100 + Math.cos(a) * (i % 3 === 0 ? 86 : 83)} y2={100 - Math.sin(a) * (i % 3 === 0 ? 86 : 83)} stroke="#3b2608" strokeWidth={i % 3 === 0 ? 2 : 1} />
      })}
    </svg>
  )
}

/** The moon's face for a given time, lit portion drawn from the phase. */
export function MoonDisc({ minutes, offsetDays }: { minutes: number; offsetDays: number }) {
  const moon = moonOn(minutes, offsetDays)
  // Terminator: an ellipse whose width follows the phase; waxing lights the right side.
  const r = 34
  const waxing = moon.phase < 0.5
  const k = Math.cos(moon.phase * 2 * Math.PI) // 1 new → -1 full
  const rx = Math.abs(k) * r
  const litSweep = waxing ? 1 : 0
  const path = `M50 ${50 - r} A${r} ${r} 0 0 ${litSweep} 50 ${50 + r} A${rx} ${r} 0 0 ${k > 0 ? 1 - litSweep : litSweep} 50 ${50 - r} Z`
  return (
    <svg viewBox="0 0 100 100" className="moon-disc" role="img" aria-label={`${moon.name}, ${Math.round(moon.illumination * 100)}% lit`}>
      <defs>
        <radialGradient id="moonlit" cx="40%" cy="40%">
          <stop offset="0%" stopColor="#fffbea" />
          <stop offset="100%" stopColor="#d8cfae" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="#1b2240" stroke="#b5852f" strokeWidth="3" />
      <circle cx="50" cy="50" r={r} fill="#2c3354" />
      <path d={path} fill="url(#moonlit)" />
      <g fill="#c2b78f" opacity="0.5"><circle cx="40" cy="40" r="4" /><circle cx="58" cy="58" r="5" /><circle cx="56" cy="34" r="2.5" /></g>
    </svg>
  )
}
