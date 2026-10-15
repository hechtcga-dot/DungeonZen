// Themed encounter rolls (owner, 2026-10-15): one creature family with a leader, chosen for the land of the
// place. Names are exact SRD 2024 monster names (tests check them). Lands: the map's biomes plus
// "settlement" (village, town, city) and "dungeon" (dungeon or ruin).

export type Land = string

export interface EncounterTheme {
  name: string
  lands: Land[]
  leaders: string[]
  troops: string[]
  /** An opening line for the scene; the DM edits it. */
  scene: string
}

export const THEMES: EncounterTheme[] = [
  { name: 'Goblin ambush', lands: ['forest', 'hills', 'grassland', 'farmland', 'mountains', 'jungle'], leaders: ['Goblin Boss', 'Hobgoblin Captain'], troops: ['Goblin Warrior', 'Goblin Minion', 'Worg'],
    scene: 'An overturned cart lies on the road ahead; a trail of fresh blood leads into the underbrush.' },
  { name: 'Bandit roadblock', lands: ['grassland', 'farmland', 'forest', 'hills', 'badlands', 'coast'], leaders: ['Bandit Captain'], troops: ['Bandit', 'Scout', 'Tough', 'Mastiff'],
    scene: 'A felled tree blocks the road. Someone has painted "TOLL" across it in red.' },
  { name: 'Hobgoblin war band', lands: ['hills', 'mountains', 'grassland', 'badlands'], leaders: ['Hobgoblin Captain'], troops: ['Hobgoblin Warrior', 'Goblin Warrior', 'Worg'],
    scene: 'Drums beat a steady rhythm beyond the ridge; boots march in step.' },
  { name: 'Bugbear raiders', lands: ['forest', 'hills', 'dungeon', 'jungle'], leaders: ['Bugbear Stalker'], troops: ['Bugbear Warrior', 'Goblin Warrior', 'Goblin Minion'],
    scene: 'Branches are snapped well above head height; something big moved through here, quietly.' },
  { name: 'Gnoll hunting pack', lands: ['grassland', 'badlands', 'desert', 'wasteland', 'farmland'], leaders: [], troops: ['Gnoll Warrior', 'Hyena', 'Giant Hyena'],
    scene: 'Cackling laughter carries on the wind. A half-eaten ox lies in the trampled grass.' },
  { name: 'Kobold trap nest', lands: ['mountains', 'hills', 'dungeon'], leaders: ['Red Dragon Wyrmling', 'White Dragon Wyrmling', 'Blue Dragon Wyrmling'], troops: ['Kobold Warrior', 'Giant Fire Beetle', 'Swarm of Rats'],
    scene: 'Tiny footprints, a tripwire at ankle height and the smell of smoke; a reedy voice sings somewhere below.' },
  { name: 'Wolf pack', lands: ['forest', 'hills', 'mountains', 'tundra', 'snow', 'grassland'], leaders: ['Werewolf', 'Dire Wolf'], troops: ['Wolf', 'Dire Wolf'],
    scene: 'Howls answer each other in the dark; eyes catch the firelight between the trees.' },
  { name: 'Cult ritual', lands: ['settlement', 'dungeon', 'swamp', 'forest', 'wasteland'], leaders: ['Cultist Fanatic', 'Priest'], troops: ['Cultist', 'Priest Acolyte', 'Imp'],
    scene: 'Chanting echoes from below; candles gutter around a circle drawn in ash.' },
  { name: 'Restless dead', lands: ['swamp', 'wasteland', 'dungeon', 'badlands', 'settlement'], leaders: ['Wight', 'Ghast', 'Mummy', 'Wraith'], troops: ['Zombie', 'Skeleton', 'Ghoul', 'Shadow'],
    scene: 'A grave has been dug open from the inside. The air turns cold and still.' },
  { name: 'Pirate landing', lands: ['coast', 'water', 'settlement'], leaders: ['Pirate Captain'], troops: ['Pirate', 'Tough', 'Bandit'],
    scene: 'A longboat has been dragged up the shingle; crates are being carried off into the dark.' },
  { name: 'Sahuagin raid', lands: ['coast', 'water'], leaders: [], troops: ['Sahuagin Warrior', 'Reef Shark', 'Hunter Shark'],
    scene: 'Fishing nets lie slashed on the beach; webbed footprints lead back into the surf.' },
  { name: 'Spider nest', lands: ['forest', 'jungle', 'dungeon', 'swamp'], leaders: ['Ettercap', 'Phase Spider'], troops: ['Giant Spider', 'Giant Wolf Spider', 'Swarm of Insects'],
    scene: 'Thick webs hang between the trees; cocooned shapes twitch in them.' },
  { name: 'Fey trickery', lands: ['forest', 'jungle', 'swamp'], leaders: ['Green Hag'], troops: ['Sprite', 'Satyr', 'Blink Dog', 'Awakened Shrub'],
    scene: 'Laughter and pipe music where no one should be; the path keeps looping back to the same stone.' },
  { name: 'Ogre gang', lands: ['hills', 'mountains', 'badlands', 'forest'], leaders: ['Hill Giant', 'Ettin', 'Ogre'], troops: ['Ogre', 'Goblin Warrior', 'Goblin Minion'],
    scene: 'Huge footprints and a smashed fence; a sheep\'s skull hangs on a pole.' },
  { name: 'Back-alley toughs', lands: ['settlement'], leaders: ['Tough Boss', 'Spy'], troops: ['Tough', 'Bandit', 'Mastiff'],
    scene: 'The alley goes quiet. Someone whistles, and figures step out of the doorways.' },
  { name: 'Swamp horrors', lands: ['swamp', 'jungle'], leaders: ['Shambling Mound', 'Green Hag'], troops: ['Crocodile', 'Giant Frog', 'Giant Toad', 'Swarm of Insects'],
    scene: 'Bubbles rise from the black water; the reeds part as something heavy moves.' },
  { name: 'Desert stalkers', lands: ['desert', 'badlands', 'wasteland'], leaders: ['Mummy', 'Lamia', 'Giant Scorpion'], troops: ['Jackal', 'Giant Scorpion', 'Swarm of Venomous Snakes', 'Giant Vulture'],
    scene: 'Bones bleach in the sun; the sand shifts where nothing should move.' },
  { name: 'Wild beasts', lands: ['forest', 'hills', 'grassland', 'mountains', 'farmland'], leaders: ['Owlbear', 'Brown Bear', 'Giant Boar'], troops: ['Black Bear', 'Boar', 'Wolf', 'Giant Badger'],
    scene: 'Claw marks gouge the bark; a half-eaten deer lies across the path.' },
  { name: 'Elemental fury', lands: ['mountains', 'wasteland', 'badlands', 'desert'], leaders: ['Fire Elemental', 'Earth Elemental', 'Salamander'], troops: ['Magma Mephit', 'Magmin', 'Steam Mephit', 'Dust Mephit'],
    scene: 'The ground is hot underfoot; small fires burn without fuel.' },
  { name: 'Frozen hunters', lands: ['tundra', 'snow'], leaders: ['Frost Giant', 'Winter Wolf', 'Polar Bear'], troops: ['Wolf', 'Ice Mephit', 'Winter Wolf'],
    scene: 'Snow drifts hide fresh tracks; the wind carries a long howl.' },
  { name: 'Checkpoint gone wrong', lands: ['settlement', 'farmland', 'grassland'], leaders: ['Knight', 'Guard Captain'], troops: ['Guard', 'Warrior Infantry', 'Scout', 'Mastiff'],
    scene: 'Soldiers in mismatched livery stop travellers at a barricade and search every cart.' },
  { name: 'Dungeon oddities', lands: ['dungeon'], leaders: ['Gelatinous Cube', 'Mimic', 'Otyugh', 'Gibbering Mouther'], troops: ['Gray Ooze', 'Rust Monster', 'Darkmantle', 'Grimlock', 'Stirge'],
    scene: 'The corridor is too clean; a few coins lie in a neat line across the floor.' }
]

const WORD_LANDS: Array<[RegExp, Land]> = [
  [/\b(field|plain|meadow|grass|prairie|steppe)/, 'grassland'], [/\b(farm|mill|orchard|crossroad|road)/, 'farmland'],
  [/\b(forest|wood|grove|thicket)/, 'forest'], [/\bjungle/, 'jungle'], [/\b(hill|moor|downs)/, 'hills'],
  [/\b(mountain|peak|cliff|pass\b|crag)/, 'mountains'], [/\b(desert|dune|sand)/, 'desert'], [/\b(badland|canyon|mesa)/, 'badlands'],
  [/\b(swamp|marsh|bog|fen|mire)/, 'swamp'], [/\b(tundra)/, 'tundra'], [/\b(snow|ice|frozen|glacier)/, 'snow'],
  [/\b(coast|beach|shore|harbou?r|port|dock|cove)/, 'coast'], [/\b(sea|lake|river|ocean)/, 'water'], [/\b(waste|blight|ash)/, 'wasteland'],
  [/\b(village|town|city|street|alley|market|tavern|inn|hamlet)/, 'settlement'],
  [/\b(dungeon|ruin|crypt|tomb|cave|cavern|catacomb|abandoned|keep|tower|mine)/, 'dungeon']
]

/** The land a typed place suggests ("open field" → grassland, "abandoned village" → dungeon and settlement). */
export function landsFromWords(text: string): Land[] {
  const t = text.toLowerCase()
  return WORD_LANDS.filter(([re]) => re.test(t)).map(([, land]) => land)
}
