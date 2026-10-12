import type { ReactNode } from 'react'
import type { CompositionId } from '../../shared/compositions'

// Thumbnail sketches of each picture composition (pen-and-ink style, drawn in code, 80 x 60).
// Filled shapes are masses (trees, figures, rocks); thin lines are horizons, roads, rays.

const M = (d: string) => <path d={d} className="cmp-mass" />
const L = (d: string) => <path d={d} className="cmp-line" />

const SKETCH: Record<CompositionId, ReactNode> = {
  thirds: <>{L('M0 42 H80')}{M('M18 42 C14 30 18 18 27 16 C36 18 38 30 33 42 Z')}{L('M58 42 l4 -5 l4 5')}<path d="M26.7 0 V60 M53.3 0 V60 M0 20 H80 M0 40 H80" className="cmp-guide" /></>,
  pyramid: <>{L('M0 48 H80')}{M('M40 10 L58 48 H22 Z')}</>,
  steelyard: <>{L('M0 46 H80')}{M('M8 46 V12 C14 8 20 12 20 18 V46 Z')}{M('M64 46 V38 H69 V46 Z')}</>,
  scales: <>{L('M0 44 H80')}{M('M6 44 C4 30 10 20 18 22 C26 22 28 34 26 44 Z')}{M('M54 44 C52 32 58 22 66 24 C74 26 76 36 74 44 Z')}{L('M30 44 L40 34 L50 44')}</>,
  scurve: <>{L('M0 30 H80')}{L('M30 60 C70 52 10 42 46 36 C60 33 40 31 44 30')}{L('M40 60 C80 52 20 42 52 36 C62 33 46 31 47 30')}</>,
  diagonal: <>{L('M0 58 L80 6')}{M('M0 60 L0 44 L30 28 L44 30 L80 8 V60 Z')}</>,
  tunnel: <>{M('M0 0 H80 V60 H64 V20 C64 12 52 8 40 8 C28 8 16 12 16 20 V60 H0 Z')}{L('M16 44 H64')}{L('M34 44 L40 36 L46 44')}</>,
  radiating: <>{L('M0 40 H80')}{M('M34 40 C34 34 46 34 46 40 Z')}{L('M40 32 L40 4 M40 32 L16 8 M40 32 L64 8 M40 32 L4 22 M40 32 L76 22')}{L('M40 40 L20 60 M40 40 L60 60')}</>,
  circular: <>{L('M40 8 C64 8 72 22 70 32 C68 46 54 52 40 52 C22 52 10 44 10 32 C10 18 22 8 40 8')}{M('M36 34 C34 26 46 26 44 34 Z')}</>,
  ell: <>{L('M0 48 H80')}{M('M8 48 V8 C12 4 18 6 18 10 V48 Z')}{M('M18 48 H76 V44 H18 Z')}</>,
  cross: <>{L('M0 40 H80')}{M('M36 56 V6 H43 V56 Z')}</>,
  threespot: <>{L('M0 42 H80')}{M('M10 42 C8 30 22 28 24 42 Z')}{M('M46 42 C46 36 54 36 54 42 Z')}{M('M66 18 C66 14 72 14 72 18 C72 22 66 22 66 18 Z')}</>,
  groupmass: <>{L('M0 44 H80')}{M('M18 44 C14 30 22 22 30 26 C34 16 46 16 50 24 C58 20 66 30 62 44 Z')}</>,
  silhouette: <>{L('M0 40 H80')}{M('M0 60 V40 H12 V24 L18 16 L24 24 V30 H34 V20 H38 V30 H48 V40 H80 V60 Z')}{M('M58 40 L64 22 L70 40 Z')}</>,
  centre: <>{L('M0 46 H80')}{M('M32 46 C28 36 30 22 40 18 C50 22 52 36 48 46 Z')}</>,
  pattern: <>{L('M0 30 H80 M0 50 H80')}{[8, 26, 44, 62].flatMap((x, i) => [M(`M${x} 30 c-2 -8 10 -8 8 0 Z`), M(`M${x + 9 - (i % 2) * 4} 50 c-2 -8 10 -8 8 0 Z`)])}</>
}

export function CompositionSketch({ id }: { id: CompositionId }) {
  return <svg className="cmp-sketch" viewBox="0 0 80 60" aria-hidden="true"><rect x="0.5" y="0.5" width="79" height="59" className="cmp-frame" />{SKETCH[id]}</svg>
}
