// Session recap with AI (owner, 1.6.0): a short story of the session from the log and the DM's
// notes, for the DM to edit before sending. Player-safe: the AI only sees the player-safe draft.

export const RECAP_SYSTEM = [
  'You write a session recap for a Dungeons & Dragons game, from the Dungeon Master\'s log and notes.',
  'Write in past tense, as a short story for the players: 2 to 5 short paragraphs, then a line "Next time:" with open threads, if the notes give any.',
  'Use only what the log and notes say; never invent events, names or results. Keep game terms light (no dice, no XP numbers unless given).',
  'Reply with the recap text only, no heading.'
].join(' ')

export function recapPrompt(input: { number: number; log: string; notes: string; current: string; playerSafe: boolean }): string {
  return [
    `Session ${input.number}.`,
    input.playerSafe ? 'This version goes to the players: it may only use what is below (people the party has not named are "a stranger").' : '',
    `Log:\n${input.log || '(empty)'}`,
    input.notes.trim() ? `DM notes for this session:\n${input.notes}` : '',
    input.current.trim() ? `The DM's current recap (keep what it says, improve the telling):\n${input.current}` : ''
  ].filter(Boolean).join('\n\n').slice(0, 60000)
}
