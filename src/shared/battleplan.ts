// Battle planner (owner, 2026-10-09): tips for the DM on how the foes should play against this party.
// Reads what the party can still do (area spells, save-or-lose spells, battlefield control, healing,
// counterspells; slots left), who is down or concentrating, and what the foes are (smart or not,
// ranged, flying, bosses). Pure: the campaign gathers the inputs, the screens show the answer.

export type SpellRole = 'area' | 'disable' | 'zone' | 'heal' | 'counter'

const ROLE_NAMES: Record<SpellRole, string[]> = {
  area: ['fireball', 'lightning bolt', 'shatter', 'thunderwave', 'burning hands', 'cone of cold', 'hypnotic pattern', 'spirit guardians', 'ice storm',
    'fear', 'circle of death', 'chain lightning', 'sunburst', 'meteor swarm', 'delayed blast fireball', 'fire storm', 'destructive wave', 'flame strike',
    'sleep', 'slow', 'color spray', 'synaptic static', 'insect plague', 'incendiary cloud', 'wall of fire', 'call lightning', 'erupting earth'],
  disable: ['banishment', 'hold person', 'hold monster', 'polymorph', 'dominate person', 'dominate monster', 'dominate beast', 'feeblemind', 'befuddlement',
    'flesh to stone', 'hideous laughter', 'command', 'suggestion', 'blindness/deafness', 'bestow curse', 'charm person', 'charm monster', 'power word stun',
    'power word kill', 'maze', 'imprisonment', 'eyebite', 'phantasmal killer', 'divine word', 'mass suggestion', 'otto\'s irresistible dance', 'irresistible dance'],
  zone: ['spike growth', 'web', 'entangle', 'plant growth', 'wall of force', 'wall of stone', 'wall of thorns', 'wall of ice', 'grease', 'hunger of hadar',
    'black tentacles', 'cloudkill', 'stinking cloud', 'fog cloud', 'darkness', 'silence', 'sleet storm', 'moonbeam', 'forcecage', 'reverse gravity', 'earthquake',
    'watery sphere', 'evard\'s black tentacles', 'wind wall'],
  heal: ['healing word', 'cure wounds', 'mass healing word', 'mass cure wounds', 'prayer of healing', 'heal', 'mass heal', 'revivify', 'raise dead',
    'aura of vitality', 'regenerate', 'resurrection', 'true resurrection', 'lay on hands'],
  counter: ['counterspell', 'dispel magic', 'shield', 'absorb elements', 'silvery barbs']
}

/** What a spell or ability does in a fight, from its name, else its text. */
export function spellRoles(name: string, text: string): SpellRole[] {
  const n = name.trim().toLowerCase()
  const roles = (Object.keys(ROLE_NAMES) as SpellRole[]).filter((r) => ROLE_NAMES[r].includes(n))
  if (roles.length) return roles
  const t = text
  if (/\b\d+-foot(-radius)?\s+(Sphere|Cone|Cube|Line|Emanation|Cylinder)\b/i.test(t) && /Saving Throw|damage/i.test(t)) roles.push('area')
  if (/difficult terrain|\bwall\b/i.test(t) && /enters|moves|ends its turn/i.test(t)) roles.push('zone')
  if (/Saving Throw/i.test(t) && /\b(Banished|Paralyzed|Stunned|Petrified|Incapacitated|Charmed)\b/i.test(t) && !roles.includes('area')) roles.push('disable')
  if (/regains? (a number of )?Hit Points|Hit Points regained/i.test(t)) roles.push('heal')
  return roles
}

export interface PlanPc {
  name: string
  ac: number | null
  hp: number
  maxHp: number
  down: boolean
  concentrating: boolean
  /** Spells and abilities with their roles; level null = no slot needed. */
  powers: Array<{ name: string; level: number | null; roles: SpellRole[]; save: string; text?: string }>
  /** Spell slots left per level 1–9. */
  slotsLeft: number[]
}

export interface PlanFoe {
  name: string
  count: number
  int: number
  cr: string
  ranged: boolean
  flies: boolean
  legendaryResist: boolean
  leader: boolean
  /** Casts spells (has Spellcasting or a spell list). */
  caster?: boolean
  /** Saving throw bonuses by ability (str…cha). */
  saves: Record<string, number>
}

export interface BattlePlan {
  party: Array<{ role: SpellRole; text: string }>
  targets: Array<{ name: string; why: string[] }>
  tips: Array<{ kind: 'do' | 'avoid' | 'watch'; text: string }>
  /** The party's spells and abilities by name, with their text (for links). */
  glossary: Record<string, string>
}

const ROLE_TITLES: Record<SpellRole, string> = {
  area: 'Hits groups', disable: 'Takes one foe out', zone: 'Controls the ground', heal: 'Heals', counter: 'Stops spells'
}
export { ROLE_TITLES }

const canCast = (level: number | null, slotsLeft: number[]) => level === null || level === 0 || slotsLeft.slice(level - 1).some((n) => n > 0)
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function battlePlan(pcs: PlanPc[], foes: PlanFoe[]): BattlePlan {
  const up = pcs.filter((p) => !p.down)
  const standing = foes.filter((f) => f.count > 0)
  const foeCount = standing.reduce((n, f) => n + f.count, 0)
  const smart = standing.filter((f) => f.int >= 8)
  const simple = standing.filter((f) => f.int < 8)
  const boss = [...standing].sort((a, b) => Number(b.leader) - Number(a.leader) || crNum(b.cr) - crNum(a.cr))[0]
  const has = (role: SpellRole) => up.flatMap((p) => p.powers.filter((s) => s.roles.includes(role) && canCast(s.level, p.slotsLeft)).map((s) => ({ pc: p.name, spell: s })))
  const spent = (role: SpellRole) => pcs.flatMap((p) => p.powers.filter((s) => s.roles.includes(role) && !canCast(s.level, p.slotsLeft)).map((s) => s.name))
  const say = (xs: Array<{ pc: string; spell: { name: string } }>) => list([...new Set(xs.map((x) => x.pc))]
    .map((pc) => `${pc} (${[...new Set(xs.filter((x) => x.pc === pc).map((x) => x.spell.name))].join(', ')})`))

  const party: BattlePlan['party'] = []
  const tips: BattlePlan['tips'] = []
  const area = has('area'), disable = has('disable'), zone = has('zone'), heal = has('heal'), counter = has('counter')
  if (area.length) {
    party.push({ role: 'area', text: say(area) })
    if (foeCount >= 3) tips.push({ kind: 'do', text: `${smart.length ? `Smart foes (${list(smart.map((f) => f.name))}) spread out 20 ft. or more` : 'Spread the foes out'}: no lines in corridors, no crowd around a fallen ally. One ${area[0].spell.name} on a bunch of ${foeCount} ends the fight.` })
    if (simple.length && foeCount >= 3) tips.push({ kind: 'watch', text: `${list(simple.map((f) => f.name))} ${simple.length === 1 && simple[0].count === 1 ? 'is' : 'are'} not clever: ${simple.length === 1 && simple[0].count === 1 ? 'it charges' : 'they bunch up and charge'}. Fair play, and a good moment for the party to shine.` })
  } else if (spent('area').length) tips.push({ kind: 'watch', text: `The party's area spells are spent (${list([...new Set(spent('area'))])}): foes can close ranks and gang up now.` })
  if (disable.length) {
    party.push({ role: 'disable', text: say(disable) })
    if (boss) {
      const saves = [...new Set(disable.map((d) => d.spell.save).filter(Boolean))]
      const weak = saves.map((s) => ({ s, n: boss.saves[s.slice(0, 3).toLowerCase()] ?? 0 })).sort((a, b) => a.n - b.n)[0]
      tips.push({ kind: 'do', text: `Protect ${boss.name}: keep it behind cover or minions, out of sight of ${list([...new Set(disable.map((d) => d.pc))])}; hit the caster to break concentration.${boss.legendaryResist ? ' It has Legendary Resistance: spend it on the first save-or-lose spell.' : ''}${weak ? ` Its weakest of those saves: ${weak.s} (${weak.n >= 0 ? '+' : ''}${weak.n}).` : ''}` })
    }
  }
  if (zone.length) {
    party.push({ role: 'zone', text: say(zone) })
    tips.push({ kind: 'avoid', text: `Choke points and narrow paths: ${list([...new Set(zone.map((z) => z.spell.name))])} turns them into a trap. Go around, wait it out, or fight from outside it.` })
    const range = standing.filter((f) => f.ranged || f.flies)
    if (range.length) tips.push({ kind: 'do', text: `${list(range.map((f) => f.name))} can ${range.some((f) => f.flies) ? 'fly over or ' : ''}shoot from outside a zone: let them.` })
  }
  if (heal.length) {
    party.push({ role: 'heal', text: say(heal) })
    tips.push({ kind: 'watch', text: `${list([...new Set(heal.map((h) => h.pc))])} can bring someone back from 0 HP: smart foes spread damage less and go for the healer.` })
  }
  if (counter.length) {
    party.push({ role: 'counter', text: say(counter) })
    if (standing.some((f) => f.caster)) tips.push({ kind: 'do', text: 'Enemy casters: bait the counterspell with a lesser spell first, or cast from more than 60 ft. away.' })
  }
  for (const p of pcs.filter((x) => x.down)) {
    tips.push({ kind: 'watch', text: `${p.name} is down. Most foes turn to whoever is still a threat; a cruel or clever foe may strike the body (each hit is a failed death save, a critical hit two).` })
  }
  if (pcs.some((p) => p.down)) tips.push({ kind: 'avoid', text: 'Finishing off a downed character just because you can: do it only when it fits the foe and the story.' })
  if (foeCount === 1 && standing[0]) tips.push({ kind: 'watch', text: `${standing[0].name} stands alone: flee, surrender, or one desperate trick?` })

  // Who smart foes go for first.
  const targets = up.map((p) => {
    const why: string[] = []
    let score = 0
    if (p.concentrating) { score += 3; why.push('concentrating on a spell (a hit forces a Constitution save)') }
    if (p.powers.some((s) => s.roles.includes('heal') && canCast(s.level, p.slotsLeft))) { score += 2; why.push('the healer') }
    if (p.powers.some((s) => s.roles.includes('area') && canCast(s.level, p.slotsLeft))) { score += 2; why.push('area spells left') }
    if (p.powers.some((s) => s.roles.includes('disable') && canCast(s.level, p.slotsLeft))) { score += 1; why.push('can take a foe out of the fight') }
    if (p.ac !== null && p.ac <= 13) { score += 1; why.push(`easy to hit (AC ${p.ac})`) }
    if (p.maxHp && p.hp <= p.maxHp / 2) { score += 1; why.push(`hurt (${p.hp}/${p.maxHp} HP)`) }
    return { name: p.name, why, score }
  }).filter((t) => t.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(({ name, why }) => ({ name, why }))
  if (targets.length && simple.length && !(area.length && foeCount >= 3)) tips.push({ kind: 'watch', text: `${list(simple.map((f) => f.name))}: no plan; ${simple.length === 1 ? 'it hits' : 'they hit'} the nearest, or whoever hurt ${simple.length === 1 ? 'it' : 'them'} last.` })
  const glossary = Object.fromEntries(pcs.flatMap((p) => p.powers.filter((s) => s.text).map((s) => [s.name, s.text!])))
  return { party, targets, tips, glossary }
}

function crNum(cr: string): number {
  const m = /^(\d+)\/(\d+)$/.exec(cr.trim())
  return m ? Number(m[1]) / Number(m[2]) : Number(cr) || 0
}
