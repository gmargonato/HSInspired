# Dynamic constructed opponent review (version 4)

Supporting cards now come from the live catalog. Archetype definitions retain only one to four defining slots, role bounds and variant priorities. No fixed supporting pools or variant card packages remain.

## Validation

- All 28 variants generated a 30-card deck at seed 42.
- All 28 variants passed 20 additional seeds (560 generations), preserving their requested identity and all composition/dependency bounds.
- A new-ID copy of Savannah Highmane entered the candidate pool and was selected in generated decks from an extended catalog, without changing archetype definitions or card ratings. A noncollectible replacement was excluded.
- Repeating a seed with the same extended catalog produced identical deck and metadata.

## Assessment

The sampled decks retain their intended support: C?Thun buffers and threshold payoffs; Jade generators; Dragon density; N?Zoth deathrattles; spell-heavy Flamewaker/Yogg lists; and recruit, totem, mech or demon support. Curve, early board presence, interaction, refill and late-threat bounds remain enforced.

The audit caught and corrected misleading weak-body classification for discounted minions and cards supplying extra bodies, and inappropriate admission of hand-discarding ramp, fragile overload minions and hero-only burn. One catalog card with an unmodeled attack restriction is explicitly excluded from generation.

These are structural generation checks and a list review, not win-rate measurements. Scoring remains heuristic: some choices are less polished than a human-tuned historical list. New unrecognized mechanics need additional assessment logic. The existing ratings and archetype targets remain curated knowledge.

## Seed 42 samples

### secret-paladin / pressure

Attempts: 2. Eligible catalog cards: 50.

- 2 Mysterious Challenger
- 2 Competitive Spirit
- 1 Avenge
- 2 Noble Sacrifice
- 1 Redemption
- 2 Truesilver Champion
- 2 Shattered Sun Cleric
- 1 Dr. Boom
- 1 Faerie Dragon
- 2 Piloted Shredder
- 1 Sunwalker
- 1 Tirion Fordring
- 1 Hammer of Wrath
- 2 Argent Squire
- 2 Annoy-o-Tron
- 1 Bomb Lobber
- 2 Haunted Creeper
- 1 Muster for Battle
- 1 Sludge Belcher
- 1 Silver Hand Knight
- 1 Defender of Argus

### secret-paladin / resilience

Attempts: 2. Eligible catalog cards: 50.

- 2 Mysterious Challenger
- 2 Competitive Spirit
- 1 Avenge
- 2 Noble Sacrifice
- 1 Redemption
- 2 Truesilver Champion
- 1 Argent Commander
- 1 Dr. Boom
- 1 Faerie Dragon
- 2 Piloted Shredder
- 1 Tirion Fordring
- 2 Hammer of Wrath
- 2 Argent Squire
- 2 Haunted Creeper
- 2 Muster for Battle
- 1 Shattered Sun Cleric
- 2 Quartermaster
- 2 Sludge Belcher
- 1 Azure Drake

### recruit-paladin / recruits

Attempts: 1. Eligible catalog cards: 46.

- 2 Quartermaster
- 2 Muster for Battle
- 1 Truesilver Champion
- 2 Hammer of Wrath
- 2 Piloted Sky Golem
- 2 Loot Hoarder
- 1 Bomb Lobber
- 2 Piloted Shredder
- 2 Sludge Belcher
- 2 Argent Squire
- 1 Tirion Fordring
- 1 Dr. Boom
- 1 Faerie Dragon
- 2 Shattered Sun Cleric
- 1 Stranglethorn Tiger
- 1 Sunwalker
- 1 Azure Drake
- 2 Dire Wolf Alpha
- 1 Harvest Golem
- 1 Annoy-o-Tron

### recruit-paladin / recovery

Attempts: 1. Eligible catalog cards: 46.

- 2 Quartermaster
- 2 Muster for Battle
- 2 Truesilver Champion
- 2 Avenging Wrath
- 2 Azure Drake
- 2 Harvest Golem
- 2 Annoy-o-Tron
- 1 Piloted Sky Golem
- 2 Sludge Belcher
- 1 Dr. Boom
- 1 Ogre Magi
- 1 Tirion Fordring
- 1 Hammer of Wrath
- 2 Argent Squire
- 1 Loot Hoarder
- 1 Consecration
- 1 Piloted Shredder
- 2 Huge Toad
- 2 Shattered Sun Cleric

### totem-shaman / spell-damage

Attempts: 1. Eligible catalog cards: 62.

- 2 Thing from Below
- 2 Thunder Bluff Valiant
- 2 Flametongue Totem
- 2 Totem Golem
- 2 Tuskarr Totemic
- 1 Doomhammer
- 2 Azure Drake
- 1 Stormcrack
- 1 Bloodmage Thalnos
- 2 Feral Spirit
- 2 Fireguard Destroyer
- 1 Elemental Destruction
- 1 Archmage
- 1 Sunwalker
- 1 Crackle
- 1 Faerie Dragon
- 1 Lightning Bolt
- 2 Lightning Storm
- 1 Fire Elemental
- 1 Piloted Shredder
- 1 Frost Shock

### totem-shaman / board-pressure

Attempts: 1. Eligible catalog cards: 62.

- 2 Thing from Below
- 2 Thunder Bluff Valiant
- 2 Flametongue Totem
- 2 Totem Golem
- 2 Tuskarr Totemic
- 2 Azure Drake
- 1 Loot Hoarder
- 1 Crackle
- 2 Flamewreathed Faceless
- 2 Lightning Storm
- 1 Knife Juggler
- 1 Cairne Bloodhoof
- 2 Fire Elemental
- 1 Fireguard Destroyer
- 2 Silver Hand Knight
- 1 Earth Elemental
- 1 Earth Shock
- 2 Feral Spirit
- 1 Frost Shock

### jade-shaman / jade-value

Attempts: 1. Eligible catalog cards: 66.

- 1 Aya Blackpaw
- 2 Jade Chieftain
- 2 Jade Claws
- 2 Jade Lightning
- 2 Jade Spirit
- 2 Totem Golem
- 1 Tuskarr Totemic
- 2 Azure Drake
- 2 Feral Spirit
- 1 Maelstrom Portal
- 2 Fire Elemental
- 2 Silver Hand Knight
- 2 Flametongue Totem
- 2 Annoy-o-Tron
- 1 Defender of Argus
- 1 Earth Shock
- 1 Crackle
- 1 Knife Juggler
- 1 Hex

### jade-shaman / tempo

Attempts: 1. Eligible catalog cards: 66.

- 1 Aya Blackpaw
- 2 Jade Chieftain
- 2 Jade Claws
- 2 Jade Lightning
- 2 Jade Spirit
- 2 Totem Golem
- 1 Tuskarr Totemic
- 2 Azure Drake
- 2 Feral Spirit
- 1 Sludge Belcher
- 2 Fire Elemental
- 2 Lightning Storm
- 2 Flametongue Totem
- 2 Annoy-o-Tron
- 1 Defender of Argus
- 1 Earth Shock
- 1 Crackle
- 1 Lightning Bolt
- 1 Frost Shock

### beast-hunter / beast-curve

Attempts: 1. Eligible catalog cards: 57.

- 2 Houndmaster
- 1 Dire Wolf Alpha
- 2 Huge Toad
- 2 Savannah Highmane
- 2 Stranglethorn Tiger
- 2 Haunted Creeper
- 1 Powershot
- 1 Kindly Grandmother
- 1 On the Hunt
- 2 Azure Drake
- 2 Piloted Shredder
- 1 Quick Shot
- 1 Infested Wolf
- 2 Shattered Sun Cleric
- 1 Piloted Sky Golem
- 1 Harvest Golem
- 1 Knife Juggler
- 1 Sludge Belcher
- 2 Annoy-o-Tron
- 1 Multi-Shot
- 1 Ogre Magi

### beast-hunter / sticky-pressure

Attempts: 1. Eligible catalog cards: 57.

- 2 Houndmaster
- 1 Dire Wolf Alpha
- 2 Haunted Creeper
- 2 Savannah Highmane
- 1 Huge Toad
- 2 Kindly Grandmother
- 1 Powershot
- 1 Sludge Belcher
- 2 Infested Wolf
- 1 Multi-Shot
- 2 Azure Drake
- 2 Quick Shot
- 2 Shattered Sun Cleric
- 2 Piloted Shredder
- 1 Faerie Dragon
- 1 Kill Command
- 2 Stranglethorn Tiger
- 1 Piloted Sky Golem
- 1 Loot Hoarder
- 1 Argent Commander

### nzoth-hunter / deathrattle-value

Attempts: 1. Eligible catalog cards: 59.

- 1 N'Zoth, the Corruptor
- 2 Savannah Highmane
- 1 Huge Toad
- 2 Kindly Grandmother
- 2 Infested Wolf
- 2 Haunted Creeper
- 1 Powershot
- 2 Sludge Belcher
- 2 Multi-Shot
- 2 Piloted Shredder
- 2 Quick Shot
- 1 Bloodfen Raptor
- 2 Azure Drake
- 1 Loot Hoarder
- 1 Dire Wolf Alpha
- 1 Harvest Golem
- 1 Bomb Lobber
- 2 Kill Command
- 1 Houndmaster
- 1 Annoy-o-Tron

### nzoth-hunter / pressure

Attempts: 1. Eligible catalog cards: 59.

- 1 N'Zoth, the Corruptor
- 2 Dire Wolf Alpha
- 2 Piloted Shredder
- 2 Savannah Highmane
- 2 Kindly Grandmother
- 2 Haunted Creeper
- 2 Infested Wolf
- 1 Cobra Shot
- 2 Multi-Shot
- 1 Bomb Lobber
- 2 Azure Drake
- 1 Carrion Grub
- 1 Ogre Magi
- 1 Dr. Boom
- 2 Loot Hoarder
- 1 Toshley
- 2 Annoy-o-Tron
- 1 Houndmaster
- 1 Kill Command
- 1 Dalaran Mage

### cthun-druid / threshold-payoffs

Attempts: 1. Eligible catalog cards: 58.

- 1 C'Thun
- 2 Beckoner of Evil
- 2 Dark Arakkoa
- 2 Nourish
- 2 Klaxxi Amber-Weaver
- 2 Skeram Cultist
- 2 Crazed Worshipper
- 1 Innervate
- 1 Disciple of C'Thun
- 1 C'Thun's Chosen
- 1 Wild Growth
- 1 Loot Hoarder
- 2 Swipe
- 2 Moonfire
- 1 Dire Wolf Alpha
- 1 Knife Juggler
- 1 Keeper of the Grove
- 2 Wrath
- 2 Shattered Sun Cleric
- 1 Power of the Wild

### cthun-druid / flexible-curve

Attempts: 1. Eligible catalog cards: 58.

- 1 C'Thun
- 2 Beckoner of Evil
- 2 Dark Arakkoa
- 2 Nourish
- 2 Klaxxi Amber-Weaver
- 2 Skeram Cultist
- 2 Crazed Worshipper
- 1 Innervate
- 1 Disciple of C'Thun
- 1 C'Thun's Chosen
- 1 Wild Growth
- 2 Loot Hoarder
- 1 Swipe
- 2 Druid of the Claw
- 2 Power of the Wild
- 2 Shattered Sun Cleric
- 2 Wrath
- 1 Argent Squire
- 1 Spider Tank

### yogg-token-druid / token-pressure

Attempts: 1. Eligible catalog cards: 56.

- 1 Yogg-Saron, Hope's End
- 2 Violet Teacher
- 2 Mark of Nature
- 2 Power of the Wild
- 2 Swipe
- 1 Wrath
- 1 Dark Wispers
- 2 Living Roots
- 1 Wisps of the Old Gods
- 2 Soul of the Forest
- 1 Starfall
- 1 Nourish
- 1 Raven Idol
- 1 Innervate
- 2 Moonfire
- 2 Haunted Creeper
- 1 Spider Tank
- 1 Mistress of Mixtures
- 1 Azure Drake
- 2 Keeper of the Grove
- 1 Shattered Sun Cleric

### yogg-token-druid / refill

Attempts: 1. Eligible catalog cards: 56.

- 1 Yogg-Saron, Hope's End
- 2 Violet Teacher
- 2 Mark of Nature
- 2 Power of the Wild
- 2 Swipe
- 2 Wrath
- 1 Dark Wispers
- 2 Living Roots
- 2 Raven Idol
- 1 Wisps of the Old Gods
- 2 Nourish
- 1 Innervate
- 1 Dire Wolf Alpha
- 1 Soul of the Forest
- 2 Harvest Golem
- 1 Knife Juggler
- 2 Keeper of the Grove
- 1 Argent Squire
- 1 Faerie Dragon
- 1 Shattered Sun Cleric

### dragon-priest / dragon-value

Attempts: 1. Eligible catalog cards: 50.

- 2 Drakonid Operative
- 2 Azure Drake
- 2 Twilight Whelp
- 2 Book Wyrm
- 1 Dragonfire Potion
- 2 Wyrmrest Agent
- 1 Twilight Guardian
- 2 Blackwing Corruptor
- 1 Holy Fire
- 2 Piloted Shredder
- 2 Faerie Dragon
- 1 Netherspite Historian
- 1 Shattered Sun Cleric
- 1 Kabal Talonpriest
- 1 Silver Hand Knight
- 2 Annoy-o-Tron
- 2 Shadow Word: Death
- 1 Haunted Creeper
- 1 Ogre Magi
- 1 Huge Toad

### dragon-priest / board-tempo

Attempts: 1. Eligible catalog cards: 50.

- 2 Drakonid Operative
- 2 Azure Drake
- 2 Faerie Dragon
- 1 Twilight Guardian
- 1 Twilight Whelp
- 2 Kabal Talonpriest
- 2 Wyrmrest Agent
- 1 Book Wyrm
- 2 Shadow Word: Death
- 1 Holy Fire
- 2 Piloted Sky Golem
- 2 Defender of Argus
- 1 Netherspite Historian
- 2 Ogre Magi
- 1 Blackwing Technician
- 1 Spider Tank
- 1 Holy Nova
- 2 Loot Hoarder
- 1 Annoy-o-Tron
- 1 Shattered Sun Cleric

### dragon-warrior / pressure

Attempts: 1. Eligible catalog cards: 63.

- 2 Alexstrasza's Champion
- 2 Azure Drake
- 2 Faerie Dragon
- 2 Fiery War Axe
- 2 Book Wyrm
- 2 Twilight Guardian
- 1 Death's Bite
- 1 Nefarian
- 1 Shieldmaiden
- 1 Cruel Taskmaster
- 1 Sludge Belcher
- 2 Ogre Magi
- 2 Warbot
- 1 Blackwing Technician
- 1 Frothing Berserker
- 1 Inner Rage
- 2 Silver Hand Knight
- 1 Shattered Sun Cleric
- 1 Sleep with the Fishes
- 1 Bomb Lobber
- 1 Whirlwind

### dragon-warrior / refill

Attempts: 1. Eligible catalog cards: 63.

- 2 Alexstrasza's Champion
- 2 Azure Drake
- 2 Faerie Dragon
- 2 Fiery War Axe
- 2 Book Wyrm
- 2 Twilight Guardian
- 1 Death's Bite
- 1 Nefarian
- 1 Shieldmaiden
- 1 Argent Squire
- 1 Frigid Snobold
- 2 Ogre Magi
- 2 Warbot
- 1 Blackwing Technician
- 1 Dire Wolf Alpha
- 1 Inner Rage
- 1 Loot Hoarder
- 1 Mistress of Mixtures
- 1 Silver Hand Knight
- 1 Kor'kron Elite
- 1 Bomb Lobber
- 1 Whirlwind

### mech-mage / sticky-mechs

Attempts: 1. Eligible catalog cards: 59.

- 2 Mechwarper
- 2 Goblin Blastmage
- 1 Annoy-o-Tron
- 2 Snowchugger
- 2 Piloted Shredder
- 2 Soot Spewer
- 2 Piloted Sky Golem
- 1 Tinkertown Technician
- 2 Spider Tank
- 2 Arcane Intellect
- 1 Micro Machine
- 1 Water Elemental
- 1 Sludge Belcher
- 2 Arcane Explosion
- 1 Dr. Boom
- 1 Frostbolt
- 1 Argent Squire
- 1 Cone of Cold
- 2 Harvest Golem
- 1 Volcanic Potion

### mech-mage / spare-parts

Attempts: 1. Eligible catalog cards: 59.

- 2 Mechwarper
- 2 Goblin Blastmage
- 2 Clockwork Gnome
- 2 Tinkertown Technician
- 2 Soot Spewer
- 2 Piloted Shredder
- 2 Snowchugger
- 2 Spider Tank
- 2 Annoy-o-Tron
- 2 Sunwalker
- 2 Azure Drake
- 1 Sludge Belcher
- 2 Arcane Explosion
- 1 Frostbolt
- 1 Argent Commander
- 2 Argent Squire
- 1 Arcane Intellect

### flamewaker-mage / board-tempo

Attempts: 1. Eligible catalog cards: 58.

- 2 Flamewaker
- 2 Arcane Explosion
- 2 Frostbolt
- 2 Arcane Intellect
- 2 Flamecannon
- 2 Violet Teacher
- 1 Volcanic Potion
- 1 Fjola Lightbane
- 2 Mana Wyrm
- 1 Greater Arcane Missiles
- 2 Arcane Missiles
- 1 Cairne Bloodhoof
- 2 Fireball
- 2 Silver Hand Knight
- 1 Blizzard
- 1 Azure Drake
- 2 Argent Squire
- 1 Piloted Shredder
- 1 Faerie Dragon

### flamewaker-mage / spell-value

Attempts: 1. Eligible catalog cards: 58.

- 2 Flamewaker
- 2 Arcane Explosion
- 2 Frostbolt
- 2 Arcane Intellect
- 2 Arcane Missiles
- 2 Violet Teacher
- 2 Arcane Blast
- 1 Fjola Lightbane
- 2 Mana Wyrm
- 2 Fireball
- 2 Azure Drake
- 1 Blizzard
- 1 Pyroblast
- 1 Cairne Bloodhoof
- 1 Argent Squire
- 1 Soot Spewer
- 2 Snowchugger
- 2 Ogre Magi

### nzoth-rogue / deathrattle-reload

Attempts: 1. Eligible catalog cards: 50.

- 1 N'Zoth, the Corruptor
- 2 Unearthed Raptor
- 1 Cairne Bloodhoof
- 1 Toshley
- 2 Piloted Shredder
- 2 Sludge Belcher
- 2 SI:7 Agent
- 2 Haunted Creeper
- 1 Undercity Huckster
- 2 Argent Squire
- 1 Defender of Argus
- 1 Huge Toad
- 2 Eviscerate
- 2 Bomb Lobber
- 1 Azure Drake
- 1 Silver Hand Knight
- 2 Harvest Golem
- 1 Sap
- 1 Knife Juggler
- 1 Archmage
- 1 Loot Hoarder

### nzoth-rogue / tempo-refill

Attempts: 1. Eligible catalog cards: 50.

- 1 N'Zoth, the Corruptor
- 2 Unearthed Raptor
- 1 Cairne Bloodhoof
- 1 Toshley
- 2 Azure Drake
- 2 Piloted Shredder
- 2 Sludge Belcher
- 2 Haunted Creeper
- 2 SI:7 Agent
- 1 Undercity Huckster
- 1 Dire Wolf Alpha
- 1 Huge Toad
- 1 Eviscerate
- 2 Bomb Lobber
- 1 Argent Squire
- 1 Stranglethorn Tiger
- 1 Faerie Dragon
- 2 Harvest Golem
- 1 Sap
- 2 Knife Juggler
- 1 Ogre Magi

### demon-warlock / egg-pressure

Attempts: 1. Eligible catalog cards: 57.

- 2 Voidcaller
- 2 Doomguard
- 1 Mal'Ganis
- 2 Imp Gang Boss
- 2 Succubus
- 2 Voidwalker
- 1 Toshley
- 1 Bane of Doom
- 1 Spreading Madness
- 1 Azure Drake
- 1 Mistress of Mixtures
- 2 Mortal Coil
- 1 Possessed Villager
- 1 Shattered Sun Cleric
- 1 Dr. Boom
- 1 Crystalweaver
- 2 Flame Imp
- 1 Darkbomb
- 1 Haunted Creeper
- 1 Piloted Shredder
- 2 Hellfire
- 1 Spider Tank

### demon-warlock / board-growth

Attempts: 1. Eligible catalog cards: 57.

- 2 Voidcaller
- 2 Doomguard
- 1 Mal'Ganis
- 2 Imp Gang Boss
- 2 Succubus
- 2 Voidwalker
- 1 Toshley
- 1 Bane of Doom
- 1 Spreading Madness
- 1 Azure Drake
- 1 Mistress of Mixtures
- 2 Mortal Coil
- 1 Darkshire Councilman
- 1 Dr. Boom
- 1 Argent Squire
- 1 Piloted Shredder
- 1 Dire Wolf Alpha
- 1 Flame Imp
- 1 Harvest Golem
- 1 Crystalweaver
- 2 Silver Hand Knight
- 1 Hellfire
- 1 Shadow Bolt
