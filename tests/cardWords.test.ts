import { describe, expect, it } from 'vitest'
import { cardSpellings, setCardWords } from '../src/main/cardWords'
import { findLinks } from '../src/renderer/components/LinkField'

describe('card names in text boxes', () => {
  it('offers the card spelling for a near miss, any case', () => {
    setCardWords(['Landanum', 'DR. PAIN'])
    expect(cardSpellings('Landanam')).toContain('Landanum')
    expect(cardSpellings('landanum')).toContain('Landanum')
    expect(cardSpellings('table')).toEqual([])
  })
  it('links card names only as whole words', () => {
    const links = [{ text: 'Pain', entityId: 'a', auto: true }]
    expect(findLinks('Painful but pain.', links).map((h) => h.from)).toEqual([12])
  })
})
