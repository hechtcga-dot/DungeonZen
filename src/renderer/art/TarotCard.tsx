import type { ReactNode } from 'react'

/** A tarot-style card: numeral, framed art, title banner, optional footer. Rendered as a real button. */
export function TarotCard(props: {
  numeral?: string
  title: string
  subtitle?: string
  art: ReactNode
  tint?: string
  footer?: ReactNode
  dimmed?: boolean
  onClick?(): void
  label?: string
  className?: string
}) {
  const body = (
    <>
      <span className="tarot-numeral">{props.numeral ?? ''}</span>
      <span className="tarot-art" style={{ background: props.tint ? `radial-gradient(circle at 50% 40%, #f6ecd0 0%, ${props.tint} 140%)` : undefined }}>
        {props.art}
      </span>
      <span className="tarot-title">{props.title}</span>
      {props.subtitle && <span className="tarot-sub">{props.subtitle}</span>}
      {props.footer && <span className="tarot-footer">{props.footer}</span>}
    </>
  )
  const cls = `tarot${props.dimmed ? ' is-dimmed' : ''} ${props.className ?? ''}`
  return props.onClick
    ? <button type="button" className={cls} onClick={props.onClick} aria-label={props.label}>{body}</button>
    : <div className={cls}>{body}</div>
}
