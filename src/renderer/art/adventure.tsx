import { useId } from 'react'
import { SUNRISE_MIN, SUNSET_MIN } from '../../shared/sky'
import { hourPalette } from '../../shared/hourPalette'

// Adventure UI art for the Desk (3.1, owner's approved mockup): the hour through an arched bronze window and the
// moon in a round night-sky window. Drawn in code; replaceable by commissioned art later.

/** The sky over the town at this campaign time; colours blend smoothly through dawn, day, dusk and night. */
export function HourScene({ minutes, className }: { minutes: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const m = ((minutes % 1440) + 1440) % 1440
  const p = hourPalette(m)
  const day = m >= SUNRISE_MIN && m < SUNSET_MIN
  // The sun (or moon) climbs and sets across the arch.
  const t = day ? (m - SUNRISE_MIN) / (SUNSET_MIN - SUNRISE_MIN) : ((m - SUNSET_MIN + 1440) % 1440) / (1440 - (SUNSET_MIN - SUNRISE_MIN))
  const bx = 22 + t * 116
  const by = 80 - Math.sin(Math.PI * t) * 54
  const u = (s: string) => `url(#${s}-${id})`
  return (
    <svg viewBox="0 0 160 104" className={className} role="img" aria-label={day ? 'The sun over the hills and the town' : 'The night over the town'}>
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.s0} /><stop offset=".45" stopColor={p.s1} /><stop offset=".75" stopColor={p.s2} /><stop offset="1" stopColor={p.s3} />
        </linearGradient>
        <radialGradient id={`bloom-${id}`}>
          <stop offset="0" stopColor={p.b0} /><stop offset=".2" stopColor={p.b1} /><stop offset=".5" stopColor={p.b1} stopOpacity=".45" /><stop offset="1" stopColor={p.b1} stopOpacity="0" />
        </radialGradient>
        <filter id={`soft-${id}`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.2" /></filter>
        <filter id={`haze-${id}`} x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="2.5" /></filter>
        <clipPath id={`arch-${id}`}><path d="M4 104V52a76 50 0 0 1 152 0v52z" /></clipPath>
      </defs>
      <g clipPath={u('arch')}>
        <rect width="160" height="104" fill={u('sky')} />
        <g fill="#fdf6dc" opacity={p.stars}>
          {[[20, 22, 0.8], [40, 12, 0.6], [62, 26, 0.7], [84, 10, 0.9], [100, 24, 0.6], [136, 20, 0.8], [30, 40, 0.5], [74, 44, 0.6], [146, 44, 0.6], [52, 8, 0.5]].map(([x, y, r]) => <circle key={`${x}`} cx={x} cy={y} r={r} />)}
        </g>
        <circle cx={bx} cy={by} r="34" fill={u('bloom')} />
        <circle cx={bx} cy={by} r={day ? 7.5 : 6.5} fill={p.sun} />
        {!day && <circle cx={bx + 3} cy={by - 2} r="6.5" fill={p.s1} />}
        <g filter={u('soft')} fill={p.cloud} opacity={p.co}>
          <path d="M86 34q2-9 11-8q4-7 12-4q8-2 10 6q7 1 6 7h-41q-3-1 2-1z" /><path d="M14 30q2-6 8-5q4-5 9-1q6 0 6 6h-24z" />
        </g>
        <ellipse cx="80" cy="66" rx="90" ry="6" fill={p.haze} opacity=".5" filter={u('haze')} />
        <path d="M0 72q22-12 44-6q20-9 42-3q24-10 46-2q16-4 28 0v43H0z" fill={p.far} />
        <path d="M0 82q26-11 56-4q30-8 58 0q24-6 46 0v26H0z" fill={p.mid} />
        <g fill="#2a1f16">
          <path d="M70 90v-8l5-4 5 4v8z" /><path d="M80 90v-11h3v-6l3-7 3 7v6h3v11z" /><path d="M92 90v-6l4-3 4 3v6z" /><path d="M100 90v-9l6-5 6 5v9z" /><path d="M112 90v-5l3-3 3 3v5z" />
        </g>
        <g fill="#ffd27a" opacity={p.win}>
          <rect x="73.5" y="85" width="1.6" height="2" /><rect x="85" y="82" width="1.4" height="2" /><rect x="104" y="84" width="1.6" height="2" /><rect x="95" y="86" width="1.4" height="2" /><rect x="114" y="86" width="1.2" height="2" />
        </g>
        <path d="M86 66q2-3 0-6q-2-3 1-6" fill="none" stroke="#e9e2d2" strokeWidth="1.4" opacity={p.smoke} filter={u('soft')} />
        <path d="M0 92q30-8 64-2q40-7 96 1v13H0z" fill={p.near} />
        <g fill="none" stroke="#2d3340" strokeWidth=".9" strokeLinecap="round" opacity={p.birds}>
          <path d="M118 40q2-2 4 0q2-2 4 0" /><path d="M128 48q1.5-1.5 3 0q1.5-1.5 3 0" />
        </g>
      </g>
      <path d="M4 104V52a76 50 0 0 1 152 0v52" fill="none" stroke="#6b4b24" strokeWidth="5" />
      <path d="M4 104V52a76 50 0 0 1 152 0v52" fill="none" stroke="#e0c488" strokeWidth="1.2" />
    </svg>
  )
}

/** The lit part of the moon's disc for a phase (0 new, 0.5 full): right side waxing, left side waning. */
export function moonLitPath(phase: number, cx = 50, cy = 50, r = 39): string {
  const k = Math.cos(2 * Math.PI * phase)
  const rx = Math.abs(k) * r
  const waxing = phase <= 0.5
  const top = `${cx} ${cy - r}`, bottom = `${cx} ${cy + r}`
  const outer = waxing ? 1 : 0
  const inner = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0)
  return `M${top}A${r} ${r} 0 0 ${outer} ${bottom}A${rx.toFixed(2)} ${r} 0 0 ${inner} ${top}z`
}

/** The moon in a round bronze window with stars; its phase drawn true. */
export function MoonArt({ phase, name, className }: { phase: number; name: string; className?: string }) {
  const id = useId().replace(/:/g, '')
  const u = (s: string) => `url(#${s}-${id})`
  const lit = moonLitPath(phase)
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={name}>
      <defs>
        <radialGradient id={`night-${id}`}><stop offset=".6" stopColor="#1c2747" /><stop offset="1" stopColor="#0b1022" /></radialGradient>
        <radialGradient id={`glow-${id}`}><stop offset=".78" stopColor="#fff3d0" stopOpacity=".5" /><stop offset="1" stopColor="#fff3d0" stopOpacity="0" /></radialGradient>
        <radialGradient id={`disc-${id}`} cx=".42" cy=".4" r=".62"><stop offset="0" stopColor="#fbf7ea" /><stop offset=".55" stopColor="#ebe4d0" /><stop offset=".85" stopColor="#cfc6ae" /><stop offset="1" stopColor="#a99f86" /></radialGradient>
        <filter id={`maria-${id}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" /></filter>
        <filter id={`grain-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={3} seed={4} />
          <feColorMatrix values="0 0 0 0 .35  0 0 0 0 .32  0 0 0 0 .26  0 0 0 .55 -.18" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <clipPath id={`lit-${id}`}><path d={lit} /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="47" fill={u('night')} />
      <g fill="#fdf6dc"><circle cx="12" cy="40" r=".7" /><circle cx="88" cy="30" r=".8" /><circle cx="86" cy="72" r=".6" /><circle cx="20" cy="80" r=".6" /></g>
      <circle cx="50" cy="50" r="39" fill="#26304e" />
      {phase > 0.4 && phase < 0.6 && <circle cx="50" cy="50" r="46" fill={u('glow')} />}
      <g clipPath={u('lit')}>
        <circle cx="50" cy="50" r="39" fill={u('disc')} />
        <g fill="#958c76" opacity=".42" filter={u('maria')}>
          <path d="M14 44q2-12 12-16q6 2 6 10q-2 8 2 16q2 10-4 16q-8 2-12-6q-5-9-4-20z" />
          <path d="M30 26q10-8 20-4q4 6-1 12q-6 6-14 4q-7-3-5-12z" />
          <path d="M54 28q7-3 11 2q2 6-3 9q-6 1-8-4q-1-4 0-7z" />
          <path d="M58 42q9-3 14 3q4 7-1 12q-6 3-11-1q-5-6-2-14z" />
          <path d="M78 36q4-1 5 3q0 4-4 4q-3-1-1-7z" />
          <path d="M66 58q6-1 8 4q1 5-4 6q-5 0-5-5q0-3 1-5z" />
          <path d="M38 60q7-3 12 1q3 5-2 9q-6 2-9-2q-3-4-1-8z" />
        </g>
        <rect x="11" y="11" width="78" height="78" filter={u('grain')} />
        <g fill="none" stroke="#fffaf0" strokeWidth=".7" opacity=".5"><circle cx="47" cy="80" r="2.4" /><circle cx="30" cy="38" r="1.6" /><circle cx="72" cy="66" r="1.4" /></g>
        <path d="M47 80l-14-6M47 80l-4-16M47 80l10-12M47 80l16-2" stroke="#fffaf0" strokeWidth=".5" opacity=".35" fill="none" />
      </g>
      <circle cx="50" cy="50" r="47" fill="none" stroke="#6b4b24" strokeWidth="4" />
      <circle cx="50" cy="50" r="47" fill="none" stroke="#e0c488" strokeWidth="1" />
    </svg>
  )
}
