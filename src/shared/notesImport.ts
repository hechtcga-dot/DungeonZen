import { z } from 'zod'
import { ENTITY_TYPES } from './schemas'

// AI notes import (Phase 5). The AI reads the DM's notes and proposes cards,
// storylines, links and questions. Nothing is campaign data until the DM presses
// "Create selected" (rule 2); AI guesses are marked (rule 10). A draft is kept in
// the campaign folder (imports/) so the DM can come back to it.

export const IMPORT_CARD_TYPES = ENTITY_TYPES.filter((t) => t !== 'PC')
export const Basis = z.enum(['stated', 'inferred'])
export type Basis = z.infer<typeof Basis>

export const Source = z.object({
  file: z.string().max(300),
  locator: z.string().max(200),
  quote: z.string().max(2000),
  basis: Basis
})
export type Source = z.infer<typeof Source>

export const CardProposal = z.object({
  id: z.string(),
  type: z.enum(ENTITY_TYPES),
  name: z.string().max(200),
  summary: z.string().max(2000),
  details: z.record(z.string(), z.string().max(5000)),
  tags: z.array(z.string().max(40)).max(20),
  sources: z.array(Source).max(50),
  basis: Basis,
  /** A card already in the campaign that looks like the same thing. */
  duplicateOf: z.object({ id: z.string(), name: z.string(), type: z.string(), exact: z.boolean() }).nullable(),
  decision: z.enum(['create', 'merge', 'skip'])
})
export type CardProposal = z.infer<typeof CardProposal>

export const StorylineProposal = z.object({
  id: z.string(),
  title: z.string().max(200),
  summary: z.string().max(2000),
  acts: z.array(z.object({ title: z.string().max(200), summary: z.string().max(2000) })).max(20),
  cardIds: z.array(z.string()).max(100),
  sources: z.array(Source).max(50),
  basis: Basis,
  decision: z.enum(['create', 'skip'])
})
export type StorylineProposal = z.infer<typeof StorylineProposal>

export const LinkProposal = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  type: z.string().max(40),
  secret: z.boolean(),
  sources: z.array(Source).max(20),
  basis: Basis,
  decision: z.enum(['create', 'skip'])
})
export type LinkProposal = z.infer<typeof LinkProposal>

export const QuestionProposal = z.object({
  id: z.string(),
  text: z.string().max(1000),
  aboutId: z.string().nullable(),
  options: z.array(z.string().max(200)).max(6),
  answer: z.string().max(2000),
  status: z.enum(['open', 'answered', 'deferred'])
})
export type QuestionProposal = z.infer<typeof QuestionProposal>

export const ImportFile = z.object({
  name: z.string(),
  kind: z.enum(['text', 'word', 'pdf', 'picture']),
  parts: z.number(),
  warnings: z.array(z.string()),
  error: z.string().nullable()
})
export type ImportFile = z.infer<typeof ImportFile>

export const ImportDraft = z.object({
  id: z.string(),
  title: z.string().max(200),
  createdAt: z.string(),
  status: z.enum(['open', 'committed', 'discarded']),
  /** Which AI read the notes (shown on every proposal). */
  source: z.string(),
  files: z.array(ImportFile),
  cards: z.array(CardProposal),
  storylines: z.array(StorylineProposal),
  links: z.array(LinkProposal),
  questions: z.array(QuestionProposal),
  /** Items the AI sent that could not be read. */
  dropped: z.number()
})
export type ImportDraft = z.infer<typeof ImportDraft>

export interface ImportDraftSummary {
  id: string
  title: string
  createdAt: string
  status: ImportDraft['status']
  cards: number
  openQuestions: number
}
