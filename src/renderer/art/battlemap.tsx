// Example battle map for the Encounters side panel, drawn in code (replaceable by painted art later):
// a ruined room on a 5 ft grid with a door, a stream, trees, rocks and start markers.

export function ExampleBattleMap({ className }: { className?: string }) {
  const grid = Array.from({ length: 11 }, (_, i) => i * 12)
  return (
    <svg className={className} viewBox="0 0 120 120" role="img" aria-label="Example battle map">
      <rect width="120" height="120" fill="#b9a46e" />
      <path d="M0 78 q30 -10 52 6 t68 -4 v18 q-34 10 -68 -2 t-52 0z" fill="#4f7a8c" opacity=".85" />
      <rect x="24" y="14" width="48" height="40" fill="#8a7a5c" />
      <g stroke="#2a1f12" strokeWidth="3" fill="none" strokeLinecap="square"><path d="M24 14h48v40h-18M42 54h-18v-40" /></g>
      <rect x="42" y="52" width="12" height="4" fill="#7a4a22" />
      <g fill="#2e5b2a" stroke="#1a3a18"><circle cx="92" cy="22" r="8" /><circle cx="104" cy="38" r="7" /><circle cx="86" cy="44" r="6" /><circle cx="12" cy="104" r="7" /></g>
      <g fill="#6b6259" stroke="#2a1f12"><path d="M36 26l6 -4 5 4 -2 6h-7z" /><path d="M96 104l5 -5 6 3 -1 6h-8z" /></g>
      <g stroke="#2a1f12" strokeOpacity=".22" strokeWidth=".6">{grid.map((x) => <path key={x} d={`M${x} 0v120M0 ${x}h120`} />)}</g>
      <g strokeWidth="1.5"><circle cx="66" cy="108" r="4" fill="#2f6fb5" stroke="#fff" /><circle cx="54" cy="108" r="4" fill="#2f6fb5" stroke="#fff" />
        <circle cx="48" cy="30" r="4" fill="#8f2a21" stroke="#fff" /><circle cx="60" cy="40" r="4" fill="#8f2a21" stroke="#fff" /></g>
    </svg>
  )
}
