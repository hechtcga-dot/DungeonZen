// Rules words that get a hover note in the Notes book view (2.8.0): conditions and senses, in short form
// (our own summaries of the SRD 5.2 rules; the full rules stay in the players' books). Spells come from the
// SRD spell list shipped with the app.

export const RULES_TERMS: Record<string, { kind: string; text: string }> = {
  Blinded: { kind: 'Condition', text: 'Can’t see and fails checks that need sight. Attacks against it have advantage; its attacks have disadvantage.' },
  Charmed: { kind: 'Condition', text: 'Can’t attack the charmer or target it with harmful effects. The charmer has advantage on checks to interact with it socially.' },
  Deafened: { kind: 'Condition', text: 'Can’t hear and fails checks that need hearing.' },
  Exhaustion: { kind: 'Condition', text: 'Levels 1–6. Each level: −2 to d20 tests and −5 ft. speed. At level 6 the creature dies. A long rest removes one level.' },
  Frightened: { kind: 'Condition', text: 'Disadvantage on checks and attacks while the source of fear is in sight; can’t willingly move closer to it.' },
  Grappled: { kind: 'Condition', text: 'Speed 0. Disadvantage on attacks against anyone but the grappler. The grappler can drag it along (at extra movement cost).' },
  Incapacitated: { kind: 'Condition', text: 'No actions, bonus actions or reactions; concentration breaks; can’t speak; rolls initiative with disadvantage.' },
  Invisible: { kind: 'Condition', text: 'Can’t be seen without magic. Attacks against it have disadvantage; its attacks have advantage. Has advantage on initiative.' },
  Paralyzed: { kind: 'Condition', text: 'Incapacitated, speed 0, fails Strength and Dexterity saves. Attacks have advantage; hits from within 5 ft. are critical.' },
  Petrified: { kind: 'Condition', text: 'Turned to stone: incapacitated, speed 0, resistant to all damage, immune to poison. Attacks have advantage.' },
  Poisoned: { kind: 'Condition', text: 'Disadvantage on attack rolls and ability checks.' },
  Prone: { kind: 'Condition', text: 'Can only crawl or stand up (half its speed). Its attacks have disadvantage; attacks from within 5 ft. have advantage, from farther disadvantage.' },
  Restrained: { kind: 'Condition', text: 'Speed 0. Its attacks and Dexterity saves have disadvantage; attacks against it have advantage.' },
  Stunned: { kind: 'Condition', text: 'Incapacitated, fails Strength and Dexterity saves. Attacks against it have advantage.' },
  Unconscious: { kind: 'Condition', text: 'Incapacitated and prone, drops what it holds, fails Strength and Dexterity saves. Attacks have advantage; hits from within 5 ft. are critical.' },
  Bloodied: { kind: 'Rules term', text: 'At half its hit points or fewer.' },
  Darkvision: { kind: 'Sense', text: 'Sees in dim light within range as if it were bright light, and in darkness as if it were dim light (shades of gray).' },
  Blindsight: { kind: 'Sense', text: 'Perceives its surroundings within range without sight.' },
  Tremorsense: { kind: 'Sense', text: 'Senses vibrations through a surface it touches, within range.' },
  Truesight: { kind: 'Sense', text: 'Within range, sees in darkness, sees invisible creatures, sees through illusions and shapechangers, and into the Ethereal Plane.' }
}

/** SRD spell names that are also everyday words: not linked in notes. */
export const COMMON_SPELL_WORDS = new Set(['Light', 'Shield', 'Message', 'Mending', 'Command', 'Darkness', 'Silence', 'Resistance', 'Sanctuary', 'Friends', 'Teleport', 'Guidance',
  'Confusion', 'Alarm', 'Fly', 'Heal', 'Slow', 'Sleep', 'Fear', 'Wish', 'Haste', 'Bless', 'Bane', 'Knock', 'Jump', 'Gate', 'Web', 'Etherealness', 'Invisibility', 'Regenerate', 'Sending', 'Commune',
  'Identify', 'Polymorph', 'Suggestion', 'Barkskin', 'Thaumaturgy', 'Prestidigitation', 'Druidcraft', 'Augury', 'Divination', 'Contingency', 'Imprisonment', 'Foresight', 'Shapechange',
  'Sequester', 'Simulacrum', 'Symbol', 'Glyph of Warding', 'Clone', 'Daylight', 'Earthquake', 'Feather Fall', 'Water Walk', 'Speak with Dead', 'Etherealness', 'Message', 'Mislead', 'Antipathy/Sympathy'])
