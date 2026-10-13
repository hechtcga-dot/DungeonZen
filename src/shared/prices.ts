// Standard 5e (SRD) prices for the shop and tavern "Add item" list, copied in (rule 8).
// Prices are in copper pieces; notes are the short rules line shown next to the item.

export interface PriceItem { name: string; group: string; cp: number; notes: string }

const gp = (n: number) => n * 100
const sp = (n: number) => n * 10
const list = (group: string, rows: Array<[string, number, string?]>): PriceItem[] => rows.map(([name, cp, notes]) => ({ name, group, cp, notes: notes ?? '' }))

export const PRICE_LIST: PriceItem[] = [
  ...list('Simple weapons', [
    ['Club', sp(1), '1d4 bludgeoning, light'], ['Dagger', gp(2), '1d4 piercing, finesse, light, thrown'], ['Greatclub', sp(2), '1d8 bludgeoning, two-handed'],
    ['Handaxe', gp(5), '1d6 slashing, light, thrown'], ['Javelin', sp(5), '1d6 piercing, thrown'], ['Light hammer', gp(2), '1d4 bludgeoning, light, thrown'],
    ['Mace', gp(5), '1d6 bludgeoning'], ['Quarterstaff', sp(2), '1d6 bludgeoning, versatile'], ['Sickle', gp(1), '1d4 slashing, light'],
    ['Spear', gp(1), '1d6 piercing, thrown, versatile'], ['Dart', 5, '1d4 piercing, finesse, thrown'], ['Light crossbow', gp(25), '1d8 piercing, 80/320'],
    ['Shortbow', gp(25), '1d6 piercing, 80/320'], ['Sling', sp(1), '1d4 bludgeoning, 30/120']
  ]),
  ...list('Martial weapons', [
    ['Battleaxe', gp(10), '1d8 slashing, versatile'], ['Flail', gp(10), '1d8 bludgeoning'], ['Glaive', gp(20), '1d10 slashing, heavy, reach'],
    ['Greataxe', gp(30), '1d12 slashing, heavy'], ['Greatsword', gp(50), '2d6 slashing, heavy'], ['Halberd', gp(20), '1d10 slashing, heavy, reach'],
    ['Lance', gp(10), '1d10 piercing, reach'], ['Longsword', gp(15), '1d8 slashing, versatile'], ['Maul', gp(10), '2d6 bludgeoning, heavy'],
    ['Morningstar', gp(15), '1d8 piercing'], ['Pike', gp(5), '1d10 piercing, heavy, reach'], ['Rapier', gp(25), '1d8 piercing, finesse'],
    ['Scimitar', gp(25), '1d6 slashing, finesse, light'], ['Shortsword', gp(10), '1d6 piercing, finesse, light'], ['Trident', gp(5), '1d8 piercing, thrown'],
    ['War pick', gp(5), '1d8 piercing'], ['Warhammer', gp(15), '1d8 bludgeoning, versatile'], ['Whip', gp(2), '1d4 slashing, finesse, reach'],
    ['Blowgun', gp(10), '1 piercing, 25/100'], ['Hand crossbow', gp(75), '1d6 piercing, light, 30/120'], ['Heavy crossbow', gp(50), '1d10 piercing, heavy, 100/400'],
    ['Longbow', gp(50), '1d8 piercing, heavy, 150/600'], ['Musket', gp(500), '1d12 piercing, 40/120'], ['Pistol', gp(250), '1d10 piercing, 30/90']
  ]),
  ...list('Ammunition', [
    ['Arrows (20)', gp(1)], ['Crossbow bolts (20)', gp(1)], ['Sling bullets (20)', 4], ['Blowgun needles (50)', gp(1)], ['Firearm bullets (10)', gp(3)]
  ]),
  ...list('Armor', [
    ['Padded armor', gp(5), 'AC 11 + Dex, light'], ['Leather armor', gp(10), 'AC 11 + Dex, light'], ['Studded leather armor', gp(45), 'AC 12 + Dex, light'],
    ['Hide armor', gp(10), 'AC 12 + Dex (max 2), medium'], ['Chain shirt', gp(50), 'AC 13 + Dex (max 2), medium'], ['Scale mail', gp(50), 'AC 14 + Dex (max 2), medium'],
    ['Breastplate', gp(400), 'AC 14 + Dex (max 2), medium'], ['Half plate armor', gp(750), 'AC 15 + Dex (max 2), medium'], ['Ring mail', gp(30), 'AC 14, heavy'],
    ['Chain mail', gp(75), 'AC 16, heavy, Str 13'], ['Splint armor', gp(200), 'AC 17, heavy, Str 15'], ['Plate armor', gp(1500), 'AC 18, heavy, Str 15'],
    ['Shield', gp(10), '+2 AC']
  ]),
  ...list('Adventuring gear', [
    ['Acid (vial)', gp(25)], ["Alchemist's fire (flask)", gp(50)], ['Antitoxin (vial)', gp(50)], ['Backpack', gp(2)], ['Ball bearings', gp(1)],
    ['Bedroll', gp(1)], ['Blanket', sp(5)], ['Caltrops', gp(1)], ['Candle', 1], ['Chain (10 ft)', gp(5)], ["Climber's kit", gp(25)],
    ['Component pouch', gp(25)], ['Crowbar', gp(2)], ['Grappling hook', gp(2)], ["Healer's kit", gp(5)], ['Holy symbol (amulet)', gp(5)],
    ['Holy water (flask)', gp(25)], ['Hunting trap', gp(5)], ['Ink (1 ounce bottle)', gp(10)], ['Lamp', sp(5)], ['Lantern, bullseye', gp(10)],
    ['Lantern, hooded', gp(5)], ['Lock', gp(10)], ['Manacles', gp(2)], ['Mirror', gp(5)], ['Oil (flask)', sp(1)], ['Paper (one sheet)', sp(2)],
    ['Parchment (one sheet)', sp(1)], ['Basic poison (vial)', gp(100)], ['Potion of healing', gp(50), 'heals 2d4 + 2'], ['Rations (1 day)', sp(5)],
    ['Rope (50 ft)', gp(1)], ['Spyglass', gp(1000)], ['Tent', gp(2)], ['Tinderbox', sp(5)], ['Torch', 1], ['Waterskin', sp(2)],
    ['Arcane focus (orb)', gp(20)], ['Druidic focus (sprig)', gp(1)], ["Burglar's pack", gp(16)], ["Dungeoneer's pack", gp(12)], ["Explorer's pack", gp(10)]
  ]),
  ...list('Tools', [
    ["Alchemist's supplies", gp(50)], ["Smith's tools", gp(20)], ["Carpenter's tools", gp(8)], ["Cook's utensils", gp(1)], ['Disguise kit', gp(25)],
    ['Forgery kit', gp(15)], ['Herbalism kit', gp(5)], ["Navigator's tools", gp(25)], ["Poisoner's kit", gp(50)], ["Thieves' tools", gp(25)],
    ['Dice set', sp(1)], ['Playing cards', sp(5)], ['Drum', gp(6)], ['Flute', gp(2)], ['Lute', gp(35)], ['Lyre', gp(30)]
  ]),
  ...list('Food, drink and lodging', [
    ['Ale (mug)', 4], ['Ale (gallon)', sp(2)], ['Bread (loaf)', 2], ['Cheese (hunk)', sp(1)], ['Meat (chunk)', sp(3)],
    ['Wine, common (pitcher)', sp(2)], ['Wine, fine (bottle)', gp(10)], ['Banquet (per person)', gp(10)],
    ['Meal, poor', 6], ['Meal, modest', sp(3)], ['Meal, comfortable', sp(5)], ['Meal, wealthy', sp(8)], ['Meal, aristocratic', gp(2)],
    ['Inn stay, squalid (per day)', 7], ['Inn stay, poor (per day)', sp(1)], ['Inn stay, modest (per day)', sp(5)],
    ['Inn stay, comfortable (per day)', sp(8)], ['Inn stay, wealthy (per day)', gp(2)], ['Inn stay, aristocratic (per day)', gp(4)],
    ['Stabling (per day)', sp(5)], ['Feed (per day)', 5]
  ]),
  ...list('Mounts and tack', [
    ['Draft horse', gp(50)], ['Riding horse', gp(75)], ['Pony', gp(30)], ['Mule', gp(8)], ['Warhorse', gp(400)], ['Saddle, riding', gp(10)], ['Saddlebags', gp(4)]
  ])
]
