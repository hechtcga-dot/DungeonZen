// Easter eggs on the Desk (owner, 1.6.0). Click the top candle to light or put it out; put it out on a
// full-moon night and a hobbit comes to light it again. Click the d20 on the mat to roll it; it stays
// where it lands; a natural 20 brings a dwarf with a lute who plays a tune and dances.
// Only looks: nothing is saved in the campaign (the die's spot is remembered in this browser).

import { useEffect, useRef, useState } from 'react'
import { Candle, D20 } from './props'

/** The header candle, clickable. `lit` is what the time of day says until the DM clicks it. */
export function EggCandle({ lit, fullMoonNight }: { lit: boolean; fullMoonNight: boolean }) {
  const [own, setOwn] = useState<boolean | null>(null)
  const [hobbit, setHobbit] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const on = own ?? lit
  const click = () => {
    if (hobbit) return
    setOwn(!on)
    if (on && fullMoonNight) {
      setHobbit(true)
      timers.current.push(window.setTimeout(() => setOwn(true), 2600))
      timers.current.push(window.setTimeout(() => setHobbit(false), 4600))
    }
  }
  return (
    <span className="egg-candle-wrap">
      <button type="button" className="egg-hit egg-candle-hit" title={on ? 'Put the candle out' : 'Light the candle'} aria-label={on ? 'Put the candle out' : 'Light the candle'} onClick={click} />
      <Candle className="desk-candle" lit={on} />
      {hobbit && <Hobbit />}
    </span>
  )
}

/** The d20 on the mat: rolls when clicked and stays where it lands. */
export function EggDice() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('dz-d20') ?? 'null') as { x: number; y: number; rot: number; value: number } | null } catch { return null } })()
  const [at, setAt] = useState(saved)
  const [rolling, setRolling] = useState(false)
  const [dwarf, setDwarf] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const roll = () => {
    if (rolling) return
    setRolling(true)
    const value = 1 + Math.floor(Math.random() * 20)
    const next = { x: 6 + Math.random() * 84, y: 55 + Math.random() * 35, rot: Math.round(Math.random() * 360), value }
    timers.current.push(window.setTimeout(() => {
      setAt(next)
      setRolling(false)
      try { localStorage.setItem('dz-d20', JSON.stringify(next)) } catch { /* only a convenience */ }
      if (value === 20) {
        setDwarf(true)
        playTune()
        timers.current.push(window.setTimeout(() => setDwarf(false), 6500))
      }
    }, 700))
  }
  const style = at ? { left: `${at.x}%`, top: `${at.y}%`, right: 'auto', bottom: 'auto', transform: `rotate(${at.rot}deg)` } : undefined
  return (
    <>
      <button type="button" className={`egg-hit egg-dice${rolling ? ' is-rolling' : ''}`} style={style} title="Roll the d20" aria-label={at ? `Roll the d20 (showing ${at.value})` : 'Roll the d20'} onClick={roll}>
        <D20 className="egg-d20" value={rolling ? Math.ceil(Math.random() * 20) : at?.value ?? 20} />
      </button>
      {dwarf && at && <Dwarf style={{ left: `${Math.min(at.x + 7, 86)}%`, top: `${Math.max(at.y - 22, 0)}%` }} />}
    </>
  )
}

/** A short jig on the lute (Web Audio plucks; quiet). */
function playTune() {
  try {
    const ctx = new AudioContext()
    const notes = [392, 440, 494, 523, 494, 440, 392, 330, 392, 440, 392, 330, 294, 330, 392]
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.22
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.22)
    })
    window.setTimeout(() => void ctx.close(), notes.length * 220 + 500)
  } catch { /* no sound, still dances */ }
}

function Hobbit() {
  return (
    <svg className="egg-hobbit" viewBox="0 0 60 90" width="68" height="102" aria-hidden="true">
      {/* curly hair, round face, green waistcoat, big bare feet, a lit taper */}
      <circle cx="30" cy="20" r="11" fill="#e9c39b" stroke="#3a2412" strokeWidth="1.2" />
      <path d="M18 18 q2 -12 12 -12 q10 0 12 12 q-3 -5 -6 -3 q-3 -5 -6 -1 q-3 -4 -6 1 q-3 -2 -6 3z" fill="#6b3f1d" />
      <circle cx="26" cy="21" r="1.2" fill="#2a1a0c" /><circle cx="34" cy="21" r="1.2" fill="#2a1a0c" />
      <path d="M26 26 q4 3 8 0" fill="none" stroke="#7a3b22" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M19 31 h22 l3 26 h-28z" fill="#3f6b33" stroke="#22381c" strokeWidth="1.2" />
      <path d="M30 31 v26" stroke="#c9a14a" strokeWidth="1.5" />
      <path d="M16 57 h28 l-2 14 h-24z" fill="#8a6a3c" stroke="#4a3518" strokeWidth="1.2" />
      <ellipse cx="22" cy="80" rx="8" ry="4" fill="#e9c39b" stroke="#3a2412" strokeWidth="1" />
      <ellipse cx="38" cy="80" rx="8" ry="4" fill="#e9c39b" stroke="#3a2412" strokeWidth="1" />
      <path d="M17 78 q3 -4 6 -1 M33 78 q3 -4 6 -1" fill="none" stroke="#6b3f1d" strokeWidth="1.5" />
      <line x1="44" y1="40" x2="52" y2="20" stroke="#efe2c2" strokeWidth="2.5" strokeLinecap="round" />
      <path className="egg-taper-flame" d="M52 11 q4 5 0 9 q-4 -4 0 -9z" fill="#ffd25e" />
      <path d="M41 40 q4 -1 5 2" fill="none" stroke="#e9c39b" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function Dwarf({ style }: { style: React.CSSProperties }) {
  return (
    <div className="egg-dwarf" style={style} aria-hidden="true">
      <span className="egg-note n1">♪</span><span className="egg-note n2">♫</span><span className="egg-note n3">♪</span>
      <svg viewBox="0 0 70 90" width="105" height="135">
        {/* helmet, big braided beard, red tunic, lute */}
        <path d="M20 16 q15 -14 30 0 v4 h-30z" fill="#8a8f96" stroke="#3b3e42" strokeWidth="1.2" />
        <path d="M18 20 h34" stroke="#c9a14a" strokeWidth="3" />
        <circle cx="35" cy="26" r="10" fill="#e5b98f" stroke="#3a2412" strokeWidth="1.2" />
        <circle cx="31" cy="25" r="1.2" fill="#2a1a0c" /><circle cx="39" cy="25" r="1.2" fill="#2a1a0c" />
        <path d="M24 28 q11 30 22 0 q-2 22 -11 26 q-9 -4 -11 -26z" fill="#b5642a" stroke="#5a2e10" strokeWidth="1.2" />
        <path d="M35 40 v14" stroke="#7a3d14" strokeWidth="1.2" />
        <path d="M22 44 h26 l3 22 h-32z" fill="#8f2a21" stroke="#4a120d" strokeWidth="1.2" />
        <path d="M21 58 h28" stroke="#3a2412" strokeWidth="3" />
        <rect x="24" y="66" width="9" height="16" fill="#5a3a1c" /><rect x="37" y="66" width="9" height="16" fill="#5a3a1c" />
        <ellipse cx="27" cy="84" rx="7" ry="3.5" fill="#2b1d10" /><ellipse cx="43" cy="84" rx="7" ry="3.5" fill="#2b1d10" />
        <g className="egg-lute">
          <ellipse cx="50" cy="56" rx="9" ry="7" fill="#c9893b" stroke="#5a3a1c" strokeWidth="1.2" />
          <circle cx="50" cy="56" r="2.2" fill="#3a2412" />
          <line x1="54" y1="50" x2="66" y2="34" stroke="#5a3a1c" strokeWidth="3" strokeLinecap="round" />
          <path d="M47 55 l17 -19 M49 57 l17 -19" stroke="#efe2c2" strokeWidth="0.6" />
        </g>
      </svg>
    </div>
  )
}
