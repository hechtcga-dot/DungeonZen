// Roll20 export (owner, 2026-10-06: both paste-in macro text and an API script).
// Pure: builds macro text, the import data and the Roll20 API (Mod) script.
//
// Roll20 has no official stat block import. Two ways in:
// 1. Macro text: paste each ability into a character's Abilities (works on every account).
// 2. API script (Roll20 Pro): install DUNGEON_ZEN_SCRIPT once, paste the data into the GM
//    notes of a handout called "Dungeon Zen import", then type !dz-import in chat. It
//    creates (or with --replace, refreshes) the characters with their attributes and
//    token-action abilities.

import { ABILITY_KEYS, abilityModifier, readStatBlock, type StatBlock } from '../../shared/statblock'
import type { AbilityView, EntityView } from '../../shared/types'
import { xpForCr } from '../../shared/encounter'

export const IMPORT_HANDOUT = 'Dungeon Zen import'

const clean = (s: string) => s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/**
 * Macro text for an ability: the DM's own macro if written, otherwise one built from
 * the description ("Attack Roll: +5", "+5 to hit", "6 (1d6 + 3) Slashing damage",
 * "DC 13 Dexterity saving throw").
 */
export function macroFor(a: Pick<AbilityView, 'name' | 'description' | 'macroText'>): string {
  if (a.macroText.trim()) return a.macroText.trim()
  const d = a.description
  const parts = [`&{template:default} {{name=${clean(a.name)}}}`]
  const hit = /Attack Roll:\s*([+-]\d+)/i.exec(d) ?? /([+-]\d+)\s+to hit/i.exec(d)
  if (hit) parts.push(`{{attack=[[1d20${signed(Number(hit[1]))}]]}}`)
  const dmg = [...d.matchAll(/\d+\s*\((\d+d\d+)(?:\s*([+-])\s*(\d+))?\)\s*([A-Za-z]+)\s+damage/gi)]
  dmg.forEach((m, i) => {
    const bonus = m[2] && m[3] ? `${m[2]}${m[3]}` : ''
    parts.push(`{{${i === 0 ? 'damage' : `damage ${i + 1}`}=[[${m[1].toLowerCase()}${bonus}]] ${m[4].toLowerCase()}}}`)
  })
  const save = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(d)
    ?? /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw:\s*DC\s*(\d+)/i.exec(d)
  if (save) {
    const [dc, ab] = /^\d+$/.test(save[1]) ? [save[1], save[2]] : [save[2], save[1]]
    parts.push(`{{save=DC ${dc} ${ab.slice(0, 3)}}}`)
  }
  if (d.trim()) parts.push(`{{description=${clean(d).slice(0, 900)}}}`)
  return parts.join(' ')
}

export interface Roll20Character {
  name: string
  bio: string
  gmnotes: string
  attributes: Record<string, string | number | { current: string | number; max: string | number }>
  abilities: Array<{ name: string; action: string; istokenaction: boolean }>
}

const SCORE_NAMES: Record<string, string> = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' }

/** Attributes in the names the "D&D 5E by Roll20" sheet uses for NPCs. */
function attributesFor(e: EntityView, sb: StatBlock | null): Roll20Character['attributes'] {
  if (!sb) return { npc: 1, npc_name: e.name }
  const hp = Number.parseInt(sb.hp, 10)
  const out: Roll20Character['attributes'] = {
    npc: 1, npc_name: e.name,
    npc_type: [sb.size, sb.creatureType].filter(Boolean).join(' ') + (sb.alignment ? `, ${sb.alignment}` : ''),
    npc_ac: sb.ac, npc_actype: sb.acDetail, npc_hpformula: sb.hitDice, npc_speed: sb.speed,
    npc_senses: sb.senses, npc_languages: sb.languages, npc_challenge: sb.cr, npc_xp: xpForCr(sb.cr),
    npc_vulnerabilities: sb.vulnerabilities, npc_resistances: sb.resistances, npc_immunities: sb.immunities,
    npc_condition_immunities: sb.conditionImmunities, npc_saving_throws: sb.saves, npc_skills: sb.skills
  }
  if (Number.isFinite(hp)) out.hp = { current: hp, max: hp }
  for (const k of ABILITY_KEYS) {
    out[SCORE_NAMES[k]] = sb[k]
    out[`${SCORE_NAMES[k]}_mod`] = abilityModifier(sb[k])
  }
  return out
}

export function roll20Character(e: EntityView, abilities: AbilityView[]): Roll20Character {
  const sb = readStatBlock(e.attributes.statblock)
  const text = (k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string).trim() : '')
  const traits = (sb?.traits ?? []).map((t) => ({ name: t.name, action: `&{template:default} {{name=${clean(t.name)}}} {{description=${clean(t.desc).slice(0, 900)}}}`, istokenaction: false }))
  return {
    name: e.name,
    bio: [text('summary'), text('bio')].filter(Boolean).join('\n\n'),
    gmnotes: [text('motivation') && `Wants: ${text('motivation')}`, text('notes')].filter(Boolean).join('\n\n'),
    attributes: attributesFor(e, sb),
    abilities: [
      ...abilities.map((a) => ({ name: a.name, action: macroFor(a), istokenaction: a.showTokenAction })),
      ...traits
    ]
  }
}

/** The data to paste into the import handout's GM notes (one line of JSON). */
export function roll20Data(chars: Roll20Character[]): string {
  return JSON.stringify({ dungeonZen: 1, characters: chars })
}

/** The Roll20 API (Mod) script. Plain ES5-style JavaScript so any Roll20 sandbox runs it. */
export const DUNGEON_ZEN_SCRIPT = `// Dungeon Zen import for Roll20 (API / Mod script). Install once per game.
// 1. Make a handout named "${IMPORT_HANDOUT}" and paste the Dungeon Zen data into its GM Notes.
// 2. Type !dz-import in chat (GM only). Add --replace to refresh characters that already exist.
on('ready', function () {
  'use strict';
  var HANDOUT = ${JSON.stringify(IMPORT_HANDOUT)};
  function unhtml(s) {
    return String(s || '')
      .replace(/<br\\s*\\/?>/gi, '\\n').replace(/<\\/p>/gi, '\\n').replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  }
  function html(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\\n/g, '<br>'); }
  function whisper(text) { sendChat('Dungeon Zen', '/w gm ' + text); }
  function setAttr(charId, name, value) {
    var current = value, max = '';
    if (value !== null && typeof value === 'object') { current = value.current; max = value.max; }
    var found = findObjs({ type: 'attribute', characterid: charId, name: name })[0];
    if (found) found.set({ current: String(current), max: String(max) });
    else createObj('attribute', { characterid: charId, name: name, current: String(current), max: String(max) });
  }
  function build(c, replace) {
    var existing = findObjs({ type: 'character', name: c.name })[0];
    if (existing && !replace) return 'skipped';
    var ch = existing || createObj('character', { name: c.name, inplayerjournals: '', controlledby: '' });
    ch.set({ bio: html(c.bio), gmnotes: html(c.gmnotes) });
    Object.keys(c.attributes || {}).forEach(function (k) { setAttr(ch.id, k, c.attributes[k]); });
    (c.abilities || []).forEach(function (a) {
      findObjs({ type: 'ability', characterid: ch.id, name: a.name }).forEach(function (old) { old.remove(); });
      createObj('ability', { characterid: ch.id, name: a.name, action: a.action, istokenaction: !!a.istokenaction });
    });
    return existing ? 'updated' : 'created';
  }
  on('chat:message', function (msg) {
    if (msg.type !== 'api' || msg.content.indexOf('!dz-import') !== 0) return;
    if (!playerIsGM(msg.playerid)) return;
    var replace = msg.content.indexOf('--replace') !== -1;
    var handout = findObjs({ type: 'handout', name: HANDOUT })[0];
    if (!handout) { whisper('Make a handout named "' + HANDOUT + '" and paste the data into its GM Notes.'); return; }
    handout.get('gmnotes', function (notes) {
      var data;
      try { data = JSON.parse(unhtml(notes)); } catch (e) { whisper('The handout GM Notes are not Dungeon Zen data: ' + e.message); return; }
      if (!data || !data.characters) { whisper('No characters in the data.'); return; }
      var counts = { created: 0, updated: 0, skipped: 0 };
      data.characters.forEach(function (c) { counts[build(c, replace)] += 1; });
      whisper('Imported: ' + counts.created + ' created, ' + counts.updated + ' updated, ' + counts.skipped + ' skipped (already there; use --replace).');
    });
  });
});
`
