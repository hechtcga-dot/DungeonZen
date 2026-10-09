import { useEffect, useState } from 'react'
import { call } from '../api'
import { ROLE_TITLES, type BattlePlan } from '../../shared/battleplan'
import { SpellText } from './SpellLink'

const KIND = { do: 'Do', avoid: 'Avoid', watch: 'Watch' } as const

/**
 * Battle planner: how the foes should play against this party. Reads the party's spells and slots left,
 * who is down or concentrating, and the foes; it changes as the fight goes (`stamp` = anything that changed).
 */
export function BattlePlanner({ encounterId, stamp }: { encounterId: string; stamp: unknown }) {
  const [plan, setPlan] = useState<BattlePlan | null>(null)
  useEffect(() => { void call('encounter:plan', { id: encounterId }).then(setPlan).catch(() => setPlan(null)) }, [encounterId, stamp])
  if (!plan) return null
  const empty = !plan.party.length && !plan.targets.length && !plan.tips.length
  return (
    <section className="battle-plan" aria-label="Battle planner">
      <h2 className="panel-title">Battle planner</h2>
      {empty && <p className="ink-muted">Nothing to plan around yet: give the characters their spells (full sheet › Spells) and add foes.</p>}
      {plan.party.length > 0 && (
        <>
          <h3 className="side-h">What the party can do</h3>
          <ul className="bp-list">{plan.party.map((p) => <li key={p.role}><strong>{ROLE_TITLES[p.role]}:</strong> <SpellText text={p.text} glossary={plan.glossary} /></li>)}</ul>
        </>
      )}
      {plan.targets.length > 0 && (
        <>
          <h3 className="side-h">Who smart foes go for first</h3>
          <ol className="bp-list">{plan.targets.map((t) => <li key={t.name}><strong>{t.name}</strong>: {t.why.join('; ')}</li>)}</ol>
        </>
      )}
      {plan.tips.length > 0 && (
        <>
          <h3 className="side-h">Tips</h3>
          <ul className="bp-list bp-tips">{plan.tips.map((t, i) => <li key={i} className={`bp-${t.kind}`}><span className="bp-kind">{KIND[t.kind]}</span> <SpellText text={t.text} glossary={plan.glossary} /></li>)}</ul>
        </>
      )}
      <p className="ink-muted bp-foot">Changes as spells are used (slots), characters go down or concentrate, and foes fall.</p>
    </section>
  )
}
