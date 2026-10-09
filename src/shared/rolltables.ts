// Generators (owner, 1.6.0): roll tables for prep and the table. Pure data plus a roller.
// An entry can use another table with {table-id}; "2d" style dice are not rolled here, the DM
// rolls in Roll20 (each table shows its die). Made up for play, or from the SRD 5.2 (CC-BY-4.0).

import type { EntityType } from './schemas'

export interface RollTable {
  id: string
  name: string
  group: string
  /** The card "Put on board" makes. */
  card: EntityType
  entries: string[]
  /** One line on what it is for. */
  hint?: string
}

const t = (id: string, name: string, group: string, card: EntityType, entries: string[], hint?: string): RollTable => ({ id, name, group, card, entries, hint })

export const GENERATOR_GROUPS = ['People', 'Places', 'Adventure', 'Treasure', 'Travel and weather', 'Random encounters', 'Dungeons', 'Odds and ends'] as const

export const BUILT_IN_TABLES: RollTable[] = [
  // ---- People
  t('npc', 'Quick NPC', 'People', 'NPC', ['{first} {last}, {species} {job}. {quirk}; {voice}. Wants {want}. Secret: {secret}.'], 'Name, species, job, quirk, voice, want and secret'),
  t('first', 'First names', 'People', 'NPC', ['Ada', 'Aldric', 'Bram', 'Brisa', 'Cora', 'Corvin', 'Dagna', 'Doran', 'Elsbeth', 'Emrys', 'Fenn', 'Greta', 'Hollis', 'Ilsa', 'Isolde', 'Jory', 'Kesta', 'Lorn', 'Maren', 'Mirela', 'Nils', 'Orla', 'Osric', 'Pell', 'Quill', 'Rosk', 'Sabine', 'Tamsin', 'Thane', 'Ulric', 'Vesna', 'Wren', 'Yorick', 'Zelda', 'Bertram', 'Calla', 'Dorian', 'Edda', 'Faelan', 'Gwen']),
  t('last', 'Family names', 'People', 'NPC', ['Ashgrove', 'Blackwater', 'Bramblefoot', 'Cobble', 'Dunmore', 'Emberly', 'Farrow', 'Greaves', 'Hightower', 'Ironwood', 'Juniper', 'Kettle', 'Lark', 'Marsh', 'Nettle', 'Oakhart', 'Pike', 'Quarry', 'Reed', 'Saltmarsh', 'Stonebrook', 'Thorne', 'Underhill', 'Vale', 'Whitlock', 'Yarrow', 'Coldwell', 'Duskmantle']),
  t('species', 'Species', 'People', 'NPC', ['human', 'human', 'human', 'elf', 'dwarf', 'halfling', 'gnome', 'orc', 'tiefling', 'dragonborn', 'goliath', 'aasimar']),
  t('job', 'Occupations', 'People', 'NPC', ['farmer', 'fishmonger', 'baker', 'blacksmith', 'stablehand', 'town guard', 'retired soldier', 'smuggler', 'dock worker', 'minor noble', 'temple acolyte', 'village priest', 'scout', 'informant', 'hedge wizard', 'sailor', 'captain of the watch', 'herbalist', 'tax collector', 'bard', 'gravedigger', 'midwife', 'cartographer', 'moneylender', 'ratcatcher', 'tailor', 'brewer', 'courier', 'scribe', 'beggar']),
  t('quirk', 'NPC quirks', 'People', 'NPC', ['hums old sea shanties', 'never looks anyone in the eye', 'collects buttons', 'speaks in whispers', 'laughs at the wrong moments', 'quotes a long-dead poet', 'is always eating something', 'counts coins while talking', 'has a pet rat in a pocket', 'cannot remember names', 'swears by a saint nobody has heard of', 'wears far too much perfume', 'finishes other people\'s sentences', 'taps the table in rhythm', 'answers questions with questions', 'is missing two fingers and tells a new story about it each time', 'keeps a tiny notebook of grudges', 'sniffs everything before touching it', 'is overly formal', 'bites their nails']),
  t('voice', 'Voices and mannerisms', 'People', 'NPC', ['a deep slow rumble', 'quick and breathless', 'a sing-song lilt', 'a dry whisper', 'loud, as if half deaf', 'a thick regional accent', 'nasal and precise', 'gravelly from pipe smoke', 'soft and kind', 'clipped military speech', 'stammers when nervous', 'speaks of themself in the third person', 'drawls every vowel', 'very fast, then very slow', 'theatrical and grand']),
  t('want', 'Motivations', 'People', 'NPC', ['to pay off a gambling debt', 'news of a missing sibling', 'to leave town before winter', 'revenge on a former partner', 'a cure for a sick child', 'to be taken seriously', 'a quiet life', 'a buyer for stolen goods', 'into the temple archive', 'to win back a lost love', 'a seat on the town council', 'to prove a rival is a fraud', 'enough coin to buy a ship', 'forgiveness for an old crime', 'to see the sea once', 'to protect their family\'s name']),
  t('secret', 'Secrets', 'People', 'NPC', ['is a spy for a rival faction', 'owes money to the thieves\' guild', 'is secretly noble-born', 'murdered someone years ago', 'is a wanted deserter', 'worships a forbidden god', 'is not who they claim to be', 'knows where a body is buried', 'is cursed and hides it', 'is in love with someone forbidden', 'has a twin nobody knows about', 'stole their master\'s spellbook', 'is a shapechanger', 'is the masked bandit everyone talks about']),
  t('patron', 'Patrons and quest givers', 'People', 'NPC', ['a nervous merchant with a lost caravan', 'a temple that needs a relic returned', 'a noble with a missing heir', 'a guild master settling a score', 'a ghost who cannot rest', 'a wizard who needs rare components', 'a village elder facing a beast', 'a ship captain short of crew', 'a mysterious hooded stranger', 'a dying knight with an unfinished oath']),

  // ---- Places
  t('tavern', 'Tavern or inn', 'Places', 'LOCATION', ['The {tavern-adj} {tavern-noun}: {tavern-feature}. Tonight: {dish}. Keeper: {first} {last}, {quirk}.'], 'Name, feature, dish and keeper'),
  t('tavern-adj', 'Tavern words (first)', 'Places', 'LOCATION', ['Prancing', 'Drunken', 'Golden', 'Rusty', 'Sleeping', 'Laughing', 'Crooked', 'Silver', 'Salty', 'Wandering', 'Weeping', 'Jolly', 'Broken', 'Blind', 'Last', 'Velvet']),
  t('tavern-noun', 'Tavern words (second)', 'Places', 'LOCATION', ['Pony', 'Dragon', 'Goose', 'Anchor', 'Lantern', 'Barrel', 'Mermaid', 'Stag', 'Kettle', 'Wyvern', 'Boar', 'Harp', 'Crown', 'Owl', 'Mug', 'Gallows']),
  t('tavern-feature', 'Tavern features', 'Places', 'LOCATION', ['a fireplace big enough to roast an ox', 'a stuffed owlbear by the door', 'a bard who only knows sad songs', 'a nightly arm-wrestling league', 'a cellar nobody may enter', 'a parrot that repeats secrets', 'floors that slope toward the bar', 'a wall of wanted posters', 'a ghost that orders ale', 'rooms named after famous heroes', 'a dice game run by a gnome', 'a back room for "private business"']),
  t('dish', 'Dishes of the day', 'Places', 'LOCATION', ['eel pie', 'mutton stew with barley', 'roasted boar with apples', 'fish soup with too much pepper', 'mushroom pasties', 'honey cakes', 'goat cheese and black bread', 'spiced sausages', 'onion soup', 'salted pork and beans', 'a mystery meat skewer', 'dwarven stone bread']),
  t('shop', 'Shop', 'Places', 'LOCATION', ['{shop-kind} run by {first} {last} ({quirk}). For sale today: {shop-stock}; {shop-stock}; {shop-stock}. Prices: {shop-prices}.'], 'Kind, owner, three things for sale and the prices'),
  t('shop-kind', 'Kinds of shop', 'Places', 'LOCATION', ['A blacksmith', 'An alchemist', 'A general store', 'A bookshop', 'A pawn shop', 'A tailor', 'A bowyer and fletcher', 'A curio shop', 'An apothecary', 'A temple stall', 'A cartographer', 'A jeweller', 'A tannery', 'A shipwright\'s chandlery']),
  t('shop-stock', 'Shop stock', 'Places', 'ITEM', ['rope (50 ft) 1 gp', 'a healing potion 50 gp', 'a lantern 5 gp', 'a longsword 15 gp', 'chain mail 75 gp', 'a shortbow 25 gp', '20 arrows 1 gp', 'a map of the region 10 gp', 'a spellbook (blank) 50 gp', 'a holy symbol 5 gp', 'thieves\' tools 25 gp', 'a disguise kit 25 gp', 'a vial of antitoxin 50 gp', 'a spyglass 1,000 gp', 'a climber\'s kit 25 gp', 'a mule 8 gp', 'caltrops 1 gp', 'a potion of climbing 75 gp', 'a scroll of a 1st-level spell 50 gp', 'a silvered dagger 102 gp']),
  t('shop-prices', 'Shop prices', 'Places', 'LOCATION', ['fair', 'a little high: the owner haggles', 'cheap: the goods are slightly used', 'very high: there is a shortage', 'half price for anyone who does a favour', 'paid in trade only']),
  t('settlement', 'Settlement', 'Places', 'LOCATION', ['{settlement-name}, a {settlement-size} known for {settlement-known}. Trouble: {settlement-trouble}.']),
  t('settlement-name', 'Settlement names', 'Places', 'LOCATION', ['Millbrook', 'Ravenford', 'Ashdown', 'Saltmere', 'Thornwick', 'Greywater', 'Highcrag', 'Oakhollow', 'Duskvale', 'Fairhaven', 'Stonebridge', 'Wolfden', 'Briarcross', 'Coldharbour']),
  t('settlement-size', 'Settlement sizes', 'Places', 'LOCATION', ['hamlet', 'village', 'village', 'market town', 'town', 'walled town', 'small city', 'port city']),
  t('settlement-known', 'Known for', 'Places', 'LOCATION', ['its cheese', 'a famous horse fair', 'a haunted lighthouse', 'its ancient bridge', 'a temple of healing', 'its strong ale', 'a mage academy', 'silver mines', 'its stubborn mayor', 'a yearly festival of lanterns']),
  t('settlement-trouble', 'Trouble in town', 'Places', 'QUEST', ['wolves taking livestock', 'a missing child', 'a corrupt sheriff', 'plague on the docks', 'a feud between two families', 'strange lights in the old mine', 'the well has run dry', 'bandits on the trade road', 'a cult recruiting in secret', 'the harvest is cursed']),

  // ---- Adventure
  t('rumour', 'Rumours', 'Adventure', 'CLUE', ['the old mill is haunted by the miller\'s wife', 'a dragon was seen over the hills', 'the mayor sold the town\'s water rights', 'smugglers use the sea caves at low tide', 'a merchant pays well for owlbear eggs', 'the duke\'s heir is an impostor', 'the temple bells rang by themselves last night', 'someone is buying every map of the old ruins', 'the blacksmith\'s apprentice can talk to crows', 'a ship came in with no crew aboard', 'gold was found in the river', 'the guard captain takes bribes']),
  t('hook', 'Plot hooks', 'Adventure', 'QUEST', ['{patron} asks the party to {quest-task}. Reward: {reward}. Catch: {twist}.'], 'Patron, task, reward and a catch'),
  t('quest-task', 'Quest tasks', 'Adventure', 'QUEST', ['escort a caravan through the pass', 'recover a stolen relic', 'find a missing scholar', 'clear a nest of monsters from a mine', 'deliver a sealed letter, unopened', 'guard a wedding from assassins', 'map a newly found ruin', 'catch a thief in the act', 'break a curse on a village', 'win a tournament under a false name']),
  t('reward', 'Rewards', 'Adventure', 'QUEST', ['100 gp each', 'a magic item from the patron\'s vault', 'land and a title', 'a favour from a powerful guild', 'a treasure map', 'free passage on a ship', 'training with a master', 'a pardon for past crimes', 'a share of the treasure found']),
  t('twist', 'Twists', 'Adventure', 'QUEST', ['the patron is the real villain', 'the monster is protecting something', 'a rival party wants the same prize', 'the target wants to be found', 'the reward is fake', 'it is a trap set by an old enemy', 'the victims are not who they seem', 'a storm cuts off the way back', 'the relic is cursed', 'time is shorter than they were told']),
  t('villain', 'Villain motives', 'Adventure', 'NPC', ['revenge for a wrong long forgotten', 'immortality at any cost', 'to bring back a lost loved one', 'to rule through fear', 'to prove they were right all along', 'to free an imprisoned god', 'wealth beyond counting', 'to purge a city they see as corrupt', 'a pact that must be paid']),

  // ---- Treasure
  t('trinket', 'Trinkets', 'Treasure', 'ITEM', ['a mummified goblin hand', 'a crystal that faintly glows in moonlight', 'a gold coin minted in an unknown land', 'a diary in a language you do not know', 'a brass ring that never tarnishes', 'an old chess piece made from glass', 'a pair of knucklebone dice, each with a skull on the 6 side', 'a small idol of a nightmarish creature', 'a rope necklace with four mummified elf fingers', 'a receipt for a parcel you never claimed', 'an 8-ounce black velvet bag of one coin-sized stone', 'a tiny silver bell without a clapper', 'a deck of cards with one card missing', 'a key to a lock you have never seen', 'a vial of dragon blood (it is not)', 'a music box that plays a sad melody', 'a glass eye', 'a wooden whistle carved like a bird', 'a fan that, when opened, shows a sleeping cat', 'a locket with a portrait of a stranger']),
  t('loot-low', 'Loot (CR 0–4)', 'Treasure', 'ITEM', ['{coins-low} and {trinket}', '{coins-low} and a potion of healing', '{coins-low}, {gem-low}', 'a {magic-common}', '{coins-low} in a moth-eaten purse'], 'Coins, gems and maybe a common magic item'),
  t('loot-mid', 'Loot (CR 5–10)', 'Treasure', 'ITEM', ['{coins-mid} and {gem-low}', '{coins-mid}, {art-object}', 'a {magic-uncommon}', '{coins-mid} and 2 potions of healing', '{gem-mid} and a {magic-common}'], 'Coins, gems, art and an uncommon item'),
  t('loot-high', 'Loot (CR 11–16)', 'Treasure', 'ITEM', ['{coins-high} and {gem-mid}', 'a {magic-rare}', '{coins-high}, {art-object}, a {magic-uncommon}', '{gem-high} and a {magic-uncommon}']),
  t('loot-epic', 'Loot (CR 17+)', 'Treasure', 'ITEM', ['{coins-epic} and {gem-high}', 'a {magic-very-rare}', '{coins-epic}, two {art-object}', 'a {magic-rare} and {gem-high}']),
  t('coins-low', 'Coins (low)', 'Treasure', 'ITEM', ['3 cp', '12 sp', '8 gp', '25 gp', '17 sp and 4 gp', '40 gp']),
  t('coins-mid', 'Coins (mid)', 'Treasure', 'ITEM', ['120 gp', '250 gp', '400 gp and 30 pp', '600 gp', '90 pp']),
  t('coins-high', 'Coins (high)', 'Treasure', 'ITEM', ['1,200 gp', '2,500 gp', '4,000 gp and 200 pp', '700 pp']),
  t('coins-epic', 'Coins (epic)', 'Treasure', 'ITEM', ['12,000 gp', '20,000 gp and 2,000 pp', '8,000 pp']),
  t('gem-low', 'Gems (10–50 gp)', 'Treasure', 'ITEM', ['an azurite (10 gp)', 'a piece of blue quartz (10 gp)', 'a moss agate (10 gp)', 'a bloodstone (50 gp)', 'a moonstone (50 gp)', 'an onyx (50 gp)']),
  t('gem-mid', 'Gems (100–500 gp)', 'Treasure', 'ITEM', ['an amethyst (100 gp)', 'a pearl (100 gp)', 'a jade (100 gp)', 'a topaz (500 gp)', 'an alexandrite (500 gp)']),
  t('gem-high', 'Gems (1,000+ gp)', 'Treasure', 'ITEM', ['an emerald (1,000 gp)', 'a black opal (1,000 gp)', 'a sapphire (1,000 gp)', 'a diamond (5,000 gp)', 'a ruby (5,000 gp)']),
  t('art-object', 'Art objects', 'Treasure', 'ITEM', ['a silver ewer (25 gp)', 'a carved bone statuette (25 gp)', 'a gold ring set with bloodstones (250 gp)', 'a silk robe with gold embroidery (250 gp)', 'a jewelled gold crown (2,500 gp)', 'a painting by a master (750 gp)']),
  t('magic-common', 'Magic items (common)', 'Treasure', 'ITEM', ['potion of healing', 'potion of climbing', 'spell scroll (cantrip)', 'spell scroll (1st level)', 'driftglobe', 'cloak of billowing']),
  t('magic-uncommon', 'Magic items (uncommon)', 'Treasure', 'ITEM', ['bag of holding', 'boots of elvenkind', 'cloak of protection', 'gloves of thievery', 'goggles of night', 'immovable rod', '+1 weapon', 'wand of magic missiles', 'potion of greater healing', 'sending stones']),
  t('magic-rare', 'Magic items (rare)', 'Treasure', 'ITEM', ['+2 weapon', 'ring of protection', 'cloak of displacement', 'flame tongue', 'boots of speed', 'necklace of fireballs', 'potion of superior healing', 'wand of fireballs']),
  t('magic-very-rare', 'Magic items (very rare)', 'Treasure', 'ITEM', ['+3 weapon', 'cloak of the bat', 'manual of bodily health', 'staff of power', 'potion of supreme healing', 'ring of regeneration']),

  // ---- Travel and weather
  t('weather', 'Weather', 'Travel and weather', 'SCENE', ['clear and calm', 'clear and hot', 'light clouds, a cool breeze', 'overcast and grey', 'light rain', 'heavy rain (lightly obscured, disadvantage on Perception by hearing)', 'thick fog (heavily obscured beyond 30 ft)', 'strong wind (disadvantage on ranged attacks)', 'thunderstorm', 'snow flurries', 'heavy snow (difficult terrain)', 'bitter cold (Constitution saves each hour without warm gear)', 'heat wave (Constitution saves each hour without water)', 'hail']),
  t('travel-event', 'Travel events (not a fight)', 'Travel and weather', 'SCENE', ['a broken-down wagon with a worried family', 'a shrine with fresh offerings', 'tracks of something very large', 'a lost child (or something pretending to be)', 'a peddler with odd wares', 'the road is washed out', 'a hanged man with a note pinned to him', 'a patrol asks for papers', 'a field of strange flowers that make people sleepy', 'a toll bridge with a greedy keeper', 'a beautiful view of a distant ruin', 'pilgrims who invite the party to share their fire', 'a dead horse still saddled, with saddlebags', 'smoke on the horizon', 'a messenger collapses at their feet', 'an abandoned camp with the fire still warm']),
  t('travel-check', 'Every 4 hours of travel (d20)', 'Travel and weather', 'SCENE', ['Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Nothing happens', 'Weather turns: {weather}', 'A travel event: {travel-event}', 'A travel event: {travel-event}', 'Signs of danger ahead (tracks, a carcass, distant howls)', 'A random encounter (roll on the region\'s table)', 'A random encounter (roll on the region\'s table)'], 'Roll a d20 each 4 hours on the road'),

  // ---- Random encounters (monster names from the SRD 5.2)
  t('enc-forest', 'Forest encounters', 'Random encounters', 'SCENE', ['1d4 wolves', 'a brown bear', '1d6 goblins and a goblin boss', '2d4 bandits', 'a dryad who wants help', 'an owlbear', '1d3 giant spiders', 'a druid tending a hurt stag', 'a green hag disguised as a lost traveller', '1d4 gnoll warriors', 'a will-o\'-wisp near a bog', 'a pack of 2d4 giant wolf spiders']),
  t('enc-road', 'Road encounters', 'Random encounters', 'SCENE', ['a merchant caravan (friendly)', '2d4 bandits and a bandit captain', 'a patrol of 1d4 guards', 'a knight on a quest', '1d4 hobgoblin warriors', 'a wandering minstrel', 'pilgrims with a scout as guide', '1d6 orc warriors', 'a noble\'s coach under attack', 'an ogre demanding a toll']),
  t('enc-hills', 'Hills and mountains', 'Random encounters', 'SCENE', ['1d4 griffons overhead', 'a hill giant', '2d4 orc warriors', 'a goat herd and its herder', 'a stone giant sleeping', '1d6 harpies', 'a young red dragon (very dangerous)', '1d4 ogres', 'an avalanche', 'dwarf prospectors']),
  t('enc-swamp', 'Swamp encounters', 'Random encounters', 'SCENE', ['1d4 lizardfolk', 'a giant crocodile', '2d6 stirges', 'a will-o\'-wisp', 'a green hag', '1d4 bullywugs (use lizardfolk)', 'a giant constrictor snake', 'a black pudding in the mud', 'a hermit who knows the paths', 'a shambling mound']),
  t('enc-coast', 'Coast and sea', 'Random encounters', 'SCENE', ['1d4 merfolk', '2d4 pirates and a pirate captain', 'a giant crab', '1d6 sahuagin', 'a shipwreck survivor', 'a sea hag', 'a reef shark pack', 'a water elemental in a storm', 'smugglers landing cargo', 'a giant octopus']),
  t('enc-city', 'City encounters', 'Random encounters', 'SCENE', ['a pickpocket (spy)', '1d4 thugs (toughs) looking for trouble', 'the city watch asks questions', 'a runaway cart', 'a street preacher', 'a noble who mistakes them for servants', 'a cultist hands out pamphlets', 'a fire breaks out', 'a wererat in the sewers', 'a duel in the square']),
  t('enc-dungeon', 'Dungeon encounters', 'Random encounters', 'SCENE', ['1d4 skeletons', '2d4 zombies', 'a gelatinous cube', 'a ghoul pack (1d4)', 'a mimic disguised as a chest', '1d6 kobolds and their traps', 'a wight and 1d4 zombies', 'a rust monster', 'an ochre jelly', 'a minotaur', 'a lost adventurer', 'a wandering spectre']),
  t('enc-underdark', 'Underdark encounters', 'Random encounters', 'SCENE', ['1d4 drow and a drow elite warrior', 'a hook horror', '1d6 myconids (peaceful)', 'a roper', '1d4 duergar', 'a carrion crawler', 'a purple worm tunnel (it passes by)', 'a spectator guarding treasure', 'a grick nest', 'a cloaker']),
  t('enc-nonfight', 'Encounters that are not fights', 'Random encounters', 'SCENE', ['a lost traveller asks the way', 'a herd crosses the path', 'a rival adventuring party', 'a hermit offers tea and riddles', 'refugees fleeing something', 'a talking animal with a request', 'a ghost repeating its last moments', 'a tax collector with guards', 'a wedding procession', 'a fortune teller who knows a name she should not', 'a celestial in disguise testing kindness', 'children playing at being heroes']),

  // ---- Dungeons
  t('room', 'Dungeon room', 'Dungeons', 'SCENE', ['{room-kind} with {room-feature}. You hear {room-sense}. {room-contents}.'], 'Kind, feature, smell or sound, contents'),
  t('room-kind', 'Room kinds', 'Dungeons', 'SCENE', ['A guardroom', 'A collapsed hall', 'A shrine', 'A flooded cellar', 'A library', 'A prison', 'A throne room', 'A crypt', 'A kitchen', 'A barracks', 'A treasury', 'A summoning circle', 'A natural cave', 'A forge']),
  t('room-feature', 'Room features', 'Dungeons', 'SCENE', ['a pit in the middle', 'pillars carved as screaming faces', 'a fountain of dark water', 'a mural that changes when not watched', 'chains hanging from the ceiling', 'a statue holding a gem', 'a ledge 20 ft up', 'a locked iron door', 'bones piled in the corners', 'a glowing rune on the floor', 'a slope of loose rubble', 'webs from wall to wall']),
  t('room-sense', 'Smells and sounds', 'Dungeons', 'SCENE', ['dripping water', 'distant chanting', 'scratching behind the walls', 'nothing at all (too quiet)', 'wind through cracks', 'a faint sob', 'clanking chains', 'the smell of rot', 'the smell of incense', 'the smell of smoke', 'buzzing flies', 'a low hum']),
  t('room-contents', 'Room contents', 'Dungeons', 'SCENE', ['It is empty', 'It is empty', 'A monster waits ({enc-dungeon})', 'A trap: {trap}', 'Treasure: {loot-low}', 'A riddle on the door: {riddle}', 'A prisoner begs for help', 'Signs someone was here recently']),
  t('trap', 'Traps', 'Dungeons', 'SCENE', ['a pit trap (DC 15 Perception to spot; 2d10 bludgeoning)', 'poison darts (DC 13 Dex save; 2d10 poison)', 'a falling block (DC 15 Dex save; 4d10 bludgeoning)', 'a scything blade (DC 14 Dex save; 3d10 slashing)', 'a fire glyph (DC 14 Dex save; 4d6 fire)', 'collapsing stairs into a slide', 'a net drops (restrained, DC 10 Str to escape)', 'a room that fills with water', 'a poison needle in a lock (DC 15 Con save; 1d10 poison, poisoned 1 hour)', 'a rolling sphere (DC 15 Dex save; 10d10 bludgeoning)', 'an alarm that wakes the guards', 'a magic mouth that screams']),
  t('door', 'Doors', 'Dungeons', 'SCENE', ['a stout wooden door (stuck, DC 12 Str)', 'an iron door (locked, DC 15 thieves\' tools)', 'a secret door (DC 15 Perception)', 'a portcullis', 'a door with a face that asks a riddle', 'a false door with a trap behind it', 'a door of bars, rusty', 'an arch with a shimmering curtain of force']),
  t('riddle', 'Riddles', 'Dungeons', 'CLUE', ['What has keys but opens no locks? (a piano)', 'The more you take, the more you leave behind. (footsteps)', 'What can run but never walks, has a mouth but never talks? (a river)', 'I have cities but no houses, forests but no trees, water but no fish. (a map)', 'What breaks when you say its name? (silence)', 'What has a neck but no head? (a bottle)', 'Feed me and I live, give me a drink and I die. (fire)', 'What can you catch but not throw? (a cold)', 'I am always hungry, I must always be fed; the finger I touch will soon turn red. (fire)', 'What gets wetter the more it dries? (a towel)']),

  // ---- Odds and ends
  t('book', 'Book titles', 'Odds and ends', 'ITEM', ['"On the Habits of Owlbears"', '"A Treatise on Planar Doors"', '"The Lost Kings of the North"', '"Recipes of the Halfling Shires"', '"Whispers from the Far Realm" (unsettling)', '"A Ledger of Debts" (someone else\'s)', '"The Hymns of the Morning Lord"', '"Poisons and Their Remedies"', '"My Life Among the Giants"', '"Ninety-Nine Knots for Sailors"']),
  t('ship', 'Ship names', 'Odds and ends', 'ITEM', ['the Saucy Kraken', 'the Grey Widow', 'the Morning Star', 'the Salt Queen', 'the Wayward Gull', 'the Iron Tide', 'the Lucky Fool', 'the Seventh Wave']),
  t('pockets', 'What is in their pockets', 'Odds and ends', 'ITEM', ['3 cp and a button', 'a love letter', 'a key on a string', 'a half-eaten apple', 'a crude map', 'a lucky rabbit\'s foot', 'dice (loaded)', 'a pawn ticket', 'a vial of perfume', 'a wanted poster of themselves']),
  t('festival', 'Festivals', 'Odds and ends', 'SCENE', ['the Lantern Night (lights on the river)', 'the Harvest Fair (contests and pies)', 'the Day of Masks', 'the Founding Day parade', 'the Midwinter Feast', 'the Storm Blessing for sailors'])
]

/** A table by id: the DM's own tables first, then the built-in ones. */
export function findTable(id: string, own: RollTable[] = []): RollTable | undefined {
  return own.find((x) => x.id === id) ?? BUILT_IN_TABLES.find((x) => x.id === id)
}

/** Rolls on a table: one entry, with every {table} inside it rolled too. */
export function rollOn(table: RollTable, own: RollTable[] = [], rng: () => number = Math.random, depth = 0): string {
  if (!table.entries.length) return ''
  const entry = table.entries[Math.floor(rng() * table.entries.length)]
  if (depth > 6) return entry
  return entry.replace(/\{([a-z0-9-]+)\}/gi, (m, id: string) => {
    const sub = findTable(id, own)
    return sub ? rollOn(sub, own, rng, depth + 1) : m
  })
}

/** The die a table needs (the DM may roll in Roll20 instead): d4, d6, d8, d10, d12, d20 or d100. */
export function dieFor(n: number): string {
  return [4, 6, 8, 10, 12, 20, 100].map((d) => `d${d}`).find((d) => Number(d.slice(1)) >= n) ?? `d${n}`
}

/** Pasted text to table entries: one per line; leading numbers, bullets and "1-2." ranges are dropped. */
export function parseEntries(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+(?:\s*[-–]\s*\d+)?[.):]?)\s+/, '').trim()).filter(Boolean)
}

/** The random encounter table for a region (by its kind and land). */
export function encounterTableFor(kind: string | null, biome: string | null): string {
  if (kind === 'city' || kind === 'town' || kind === 'village') return 'enc-city'
  if (kind === 'dungeon') return 'enc-dungeon'
  if (kind === 'sea') return 'enc-coast'
  const by: Record<string, string> = {
    forest: 'enc-forest', jungle: 'enc-forest', hills: 'enc-hills', mountains: 'enc-hills', swamp: 'enc-swamp',
    coast: 'enc-coast', water: 'enc-coast', snow: 'enc-hills', tundra: 'enc-hills'
  }
  return (biome && by[biome]) || 'enc-road'
}

/** One check per started 4 hours on the road (none for under an hour). */
export function travelChecks(minutes: number): number {
  return minutes < 60 ? 0 : Math.ceil(minutes / 240)
}
