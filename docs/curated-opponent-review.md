# Curated opponent review: 27 decks

## Method and result

Generator version 3. Three decks per class, using seeds 20260915, 20260916 and 20260917. For coverage, the first two explicitly select each class archetype (or both variants when the class has one archetype); the third uses normal seeded archetype selection. Thus every one of the 14 enabled archetypes appears. This is coverage sampling, not an estimate of production selection frequencies.

All 27 decks completed on the first attempt without fallback. All passed normal class/copy legality, the mandatory core, curated card eligibility, situational-card caps, and archetype-specific support/curve checks. All 27 card-count records are distinct. An additional 2,800 forced package generations (100 per variant) and 900 normal class generations passed, including deterministic replay and reconstruction from the 30 logged selections. An injected impossible archetype confirmed that fallback selects another curated class package and records why.

These are deck-generation simulations and static quality reviews, not AI-played matches or win-rate measurements. The assessments below concern identity, support, curve, interaction and foreseeable sequencing demands. Live local card costs/effects are authoritative; historical sources inform package structure, not card balance values. Role counts overlap and measure opportunities: conditional draw and generated cards are not guaranteed refill.

## Overall assessment

These decks have substantially clearer identities than the previous free-form lists: the required payoffs and supporting packages survive every generation, weak generic filler is unavailable, and Loatheb/Curator fill appropriate supporting roles. The most straightforward construction targets are Beast Hunter, Secret Paladin, Dragon Priest/Warrior, Mech Mage and Totem Shaman. C'Thun has a complete, proactive support package. N'Zoth decks have meaningful resurrection bodies, with small-body dilution still a tradeoff. Yogg Token Druid and the more synergistic Demonlock variants need the most attention in AI playtesting. No numerical strength score is claimed.

| Class   | First deck                       | Second deck                       | Third deck                       |
| ------- | -------------------------------- | --------------------------------- | -------------------------------- |
| Warlock | demon-warlock / egg-pressure     | demon-warlock / board-growth      | demon-warlock / egg-pressure     |
| Hunter  | beast-hunter / beast-curve       | nzoth-hunter / deathrattle-value  | beast-hunter / sticky-pressure   |
| Rogue   | nzoth-rogue / deathrattle-reload | nzoth-rogue / tempo-refill        | nzoth-rogue / deathrattle-reload |
| Warrior | dragon-warrior / pressure        | dragon-warrior / curator-refill   | dragon-warrior / pressure        |
| Druid   | cthun-druid / threshold-payoffs  | yogg-token-druid / token-pressure | cthun-druid / flexible-curve     |
| Paladin | secret-paladin / pressure        | recruit-paladin / recruits        | secret-paladin / resilience      |
| Priest  | dragon-priest / dragon-value     | dragon-priest / board-tempo       | dragon-priest / dragon-value     |
| Mage    | mech-mage / sticky-mechs         | flamewaker-mage / board-tempo     | mech-mage / spare-parts          |
| Shaman  | totem-shaman / spell-damage      | jade-shaman / jade-value          | totem-shaman / board-pressure    |

## Warlock

### 1. demon-warlock - egg-pressure

Seed: **20260915**. Assessment: **Coherent proactive Demonlock**.

Two Voidcallers and three premium demon hits sit behind a substantial early board; six Egg activators support both Eggs. This has a real tempo engine and enough interaction to protect it.

**Remaining concern:** Life Tap and Doomguard discard decisions still matter. Cheap demons left in hand can reduce the quality of a Voidcaller summon.

**Printed mana curve:** 0 mana: 1; 1 mana: 7; 2 mana: 10; 3 mana: 3; 4 mana: 6; 5 mana: 2; 7+ mana: 1.

**Support checks:** early 14 (allowed 8-30); board 23 (allowed 16-30); interaction 7 (allowed 3-30); resource 2 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 1 (allowed 1-3); cost:4-5 8 (allowed 5-11); tribe:Demon 12 (allowed 9-30); egg-activator 6 (allowed 4-30).

| Copies | Card               | Mana |
| ------ | ------------------ | ---- |
| 1      | Soulfire           | 0    |
| 1      | Abusive Sergeant   | 1    |
| 2      | Flame Imp          | 1    |
| 2      | Power Overwhelming | 1    |
| 2      | Voidwalker         | 1    |
| 2      | Dark Peddler       | 2    |
| 2      | Darkbomb           | 2    |
| 2      | Haunted Creeper    | 2    |
| 2      | Knife Juggler      | 2    |
| 2      | Nerubian Egg       | 2    |
| 2      | Imp Gang Boss      | 3    |
| 1      | Void Terror        | 3    |
| 2      | Defender of Argus  | 4    |
| 2      | Imp-losion         | 4    |
| 2      | Voidcaller         | 4    |
| 2      | Doomguard          | 5    |
| 1      | Mal'Ganis          | 9    |

### 2. demon-warlock - board-growth

Seed: **20260916**. Assessment: **Coherent board-growth variant**.

Both Councilmen benefit from Creeper, Imp Gang Boss and Imp-losion. Voidcaller plus the expensive demons remains intact, and Dr. Boom adds a separate late threat.

**Remaining concern:** The optional Egg and Void Terror add sequencing complexity; the AI must avoid sacrificing a board without a concrete advantage.

**Printed mana curve:** 0 mana: 1; 1 mana: 7; 2 mana: 7; 3 mana: 5; 4 mana: 6; 5 mana: 2; 7+ mana: 2.

**Support checks:** early 15 (allowed 8-30); board 25 (allowed 16-30); interaction 6 (allowed 3-30); resource 2 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 2 (allowed 1-3); cost:4-5 8 (allowed 5-11); tribe:Demon 12 (allowed 9-30); egg-activator 6 (allowed 4-30).

| Copies | Card                 | Mana |
| ------ | -------------------- | ---- |
| 1      | Soulfire             | 0    |
| 1      | Abusive Sergeant     | 1    |
| 2      | Flame Imp            | 1    |
| 2      | Power Overwhelming   | 1    |
| 2      | Voidwalker           | 1    |
| 2      | Dark Peddler         | 2    |
| 1      | Darkbomb             | 2    |
| 2      | Haunted Creeper      | 2    |
| 1      | Knife Juggler        | 2    |
| 1      | Nerubian Egg         | 2    |
| 2      | Darkshire Councilman | 3    |
| 2      | Imp Gang Boss        | 3    |
| 1      | Void Terror          | 3    |
| 2      | Defender of Argus    | 4    |
| 2      | Imp-losion           | 4    |
| 2      | Voidcaller           | 4    |
| 2      | Doomguard            | 5    |
| 1      | Dr. Boom             | 7    |
| 1      | Mal'Ganis            | 9    |

### 3. demon-warlock - egg-pressure

Seed: **20260917**. Assessment: **Coherent, slightly heavier Demonlock**.

Seven Egg activators support the sticky early package. Loatheb protects an established board, while Doomguard and Mal'Ganis supply the main finish.

**Remaining concern:** Loatheb and Dr. Boom make this slower than the first sample; only five immediate interaction cards means favorable trades remain essential.

**Printed mana curve:** 0 mana: 1; 1 mana: 8; 2 mana: 7; 3 mana: 3; 4 mana: 6; 5 mana: 3; 7+ mana: 2.

**Support checks:** early 14 (allowed 8-30); board 25 (allowed 16-30); interaction 5 (allowed 3-30); resource 2 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 2 (allowed 1-3); cost:4-5 9 (allowed 5-11); tribe:Demon 12 (allowed 9-30); egg-activator 7 (allowed 4-30).

| Copies | Card               | Mana |
| ------ | ------------------ | ---- |
| 1      | Soulfire           | 0    |
| 2      | Abusive Sergeant   | 1    |
| 2      | Flame Imp          | 1    |
| 2      | Power Overwhelming | 1    |
| 2      | Voidwalker         | 1    |
| 2      | Dark Peddler       | 2    |
| 2      | Haunted Creeper    | 2    |
| 1      | Knife Juggler      | 2    |
| 2      | Nerubian Egg       | 2    |
| 2      | Imp Gang Boss      | 3    |
| 1      | Void Terror        | 3    |
| 2      | Defender of Argus  | 4    |
| 2      | Imp-losion         | 4    |
| 2      | Voidcaller         | 4    |
| 2      | Doomguard          | 5    |
| 1      | Loatheb            | 5    |
| 1      | Dr. Boom           | 7    |
| 1      | Mal'Ganis          | 9    |

## Hunter

### 1. beast-hunter - beast-curve

Seed: **20260915**. Assessment: **Strong archetype fit**.

Twelve printed Beasts support Houndmaster and Kill Command; Highmanes and Call of the Wild provide clear follow-up pressure. Draw/discovery supports continued development.

**Remaining concern:** Two Unleash the Hounds can be awkward against narrow boards. There is no Deadly Shot in this sample, so large taunts may require trades.

**Printed mana curve:** 1 mana: 1; 2 mana: 11; 3 mana: 6; 4 mana: 7; 5 mana: 2; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 7 (allowed 6-30); board 23 (allowed 16-30); interaction 6 (allowed 3-30); resource 5 (allowed 1-30); cost:8+ 1 (allowed 0-1); cost:6+ 3 (allowed 2-5); cost:4-5 9 (allowed 6-12); tribe:Beast 12 (allowed 10-30).

| Copies | Card               | Mana |
| ------ | ------------------ | ---- |
| 1      | Fiery Bat          | 1    |
| 1      | Freezing Trap      | 2    |
| 2      | Haunted Creeper    | 2    |
| 2      | Kindly Grandmother | 2    |
| 2      | King's Elekk       | 2    |
| 2      | Quick Shot         | 2    |
| 2      | Unleash the Hounds | 2    |
| 2      | Animal Companion   | 3    |
| 2      | Eaglehorn Bow      | 3    |
| 2      | Kill Command       | 3    |
| 2      | Houndmaster        | 4    |
| 2      | Infested Wolf      | 4    |
| 2      | Piloted Shredder   | 4    |
| 1      | Tomb Spider        | 4    |
| 2      | Azure Drake        | 5    |
| 2      | Savannah Highmane  | 6    |
| 1      | Call of the Wild   | 8    |

### 2. nzoth-hunter - deathrattle-value

Seed: **20260916**. Assessment: **Coherent N'Zoth variant**.

Thirteen Deathrattles include eight substantial bodies, with Highmanes, Cairne and Belchers giving resurrection meaningful value. The Beast curve and damage package remain intact.

**Remaining concern:** Slower than ordinary Beast Hunter. Early small Deathrattles can occupy resurrection slots; having N'Zoth available does not guarantee an ideal board.

**Printed mana curve:** 1 mana: 1; 2 mana: 9; 3 mana: 7; 4 mana: 5; 5 mana: 4; 6 mana: 3; 7+ mana: 1.

**Support checks:** early 7 (allowed 6-30); board 22 (allowed 16-30); interaction 7 (allowed 3-30); resource 4 (allowed 1-30); cost:8+ 1 (allowed 0-1); cost:6+ 4 (allowed 2-5); cost:4-5 9 (allowed 6-12); tribe:Beast 11 (allowed 10-30); deathrattle 13 (allowed 9-30); large-deathrattle 8 (allowed 4-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 1      | Fiery Bat             | 1    |
| 1      | Freezing Trap         | 2    |
| 2      | Haunted Creeper       | 2    |
| 2      | Kindly Grandmother    | 2    |
| 2      | King's Elekk          | 2    |
| 2      | Quick Shot            | 2    |
| 2      | Animal Companion      | 3    |
| 1      | Deadly Shot           | 3    |
| 2      | Eaglehorn Bow         | 3    |
| 2      | Kill Command          | 3    |
| 2      | Houndmaster           | 4    |
| 2      | Infested Wolf         | 4    |
| 1      | Piloted Shredder      | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Sludge Belcher        | 5    |
| 1      | Cairne Bloodhoof      | 6    |
| 2      | Savannah Highmane     | 6    |
| 1      | N'Zoth, the Corruptor | 10   |

### 3. beast-hunter - sticky-pressure

Seed: **20260917**. Assessment: **Strong proactive curve**.

Twelve Beasts, both Highmanes, Call of the Wild and Tigers give repeated pressure. Deadly Shot adds a way through a large blocker.

**Remaining concern:** Two Unleash cards and a substantial four-to-five-mana section can produce situational hands.

**Printed mana curve:** 1 mana: 2; 2 mana: 9; 3 mana: 7; 4 mana: 5; 5 mana: 4; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 7 (allowed 6-30); board 23 (allowed 16-30); interaction 7 (allowed 3-30); resource 4 (allowed 1-30); cost:8+ 1 (allowed 0-1); cost:6+ 3 (allowed 2-5); cost:4-5 9 (allowed 6-12); tribe:Beast 12 (allowed 10-30).

| Copies | Card                | Mana |
| ------ | ------------------- | ---- |
| 2      | Fiery Bat           | 1    |
| 2      | Haunted Creeper     | 2    |
| 2      | Kindly Grandmother  | 2    |
| 1      | King's Elekk        | 2    |
| 2      | Quick Shot          | 2    |
| 2      | Unleash the Hounds  | 2    |
| 2      | Animal Companion    | 3    |
| 1      | Deadly Shot         | 3    |
| 2      | Eaglehorn Bow       | 3    |
| 2      | Kill Command        | 3    |
| 2      | Houndmaster         | 4    |
| 1      | Infested Wolf       | 4    |
| 2      | Piloted Shredder    | 4    |
| 2      | Azure Drake         | 5    |
| 2      | Stranglethorn Tiger | 5    |
| 2      | Savannah Highmane   | 6    |
| 1      | Call of the Wild    | 8    |

## Rogue

### 1. nzoth-rogue - deathrattle-reload

Seed: **20260915**. Assessment: **Coherent Deathrattle tempo**.

Fourteen Deathrattles support Raptor, with eight substantial resurrection bodies. Cheap removal and SI:7 Agent protect early development; Drake and Huckster refill.

**Remaining concern:** Many small Deathrattles can dilute a full N'Zoth resurrection. The deck has limited healing, so weapon damage cannot be taken carelessly.

**Printed mana curve:** 0 mana: 2; 1 mana: 1; 2 mana: 9; 3 mana: 6; 4 mana: 6; 5 mana: 4; 6 mana: 1; 7+ mana: 1.

**Support checks:** early 10 (allowed 6-30); board 22 (allowed 16-30); interaction 9 (allowed 3-30); resource 8 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 2 (allowed 2-5); cost:4-5 10 (allowed 6-12); deathrattle 14 (allowed 9-30); large-deathrattle 8 (allowed 4-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Backstab              | 0    |
| 1      | Deadly Poison         | 1    |
| 2      | Eviscerate            | 2    |
| 2      | Haunted Creeper       | 2    |
| 2      | Loot Hoarder          | 2    |
| 1      | Sap                   | 2    |
| 2      | Undercity Huckster    | 2    |
| 1      | Fan of Knives         | 3    |
| 1      | Shadow Strike         | 3    |
| 2      | SI:7 Agent            | 3    |
| 2      | Unearthed Raptor      | 3    |
| 1      | Defender of Argus     | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Tomb Pillager         | 4    |
| 1      | Xaril, Poisoned Mind  | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Sludge Belcher        | 5    |
| 1      | Cairne Bloodhoof      | 6    |
| 1      | N'Zoth, the Corruptor | 10   |

### 2. nzoth-rogue - tempo-refill

Seed: **20260916**. Assessment: **Coherent refill variant**.

Loot Hoarders and Hucksters offer useful early Raptor copies, while Shredders, Belchers and Sylvanas supply the later reload. Nine interaction opportunities support tempo.

**Remaining concern:** Refill is abundant, but there is little immediate burst. Winning depends on protecting and rebuilding boards rather than drawing toward a combo.

**Printed mana curve:** 0 mana: 2; 1 mana: 1; 2 mana: 9; 3 mana: 6; 4 mana: 6; 5 mana: 4; 6 mana: 1; 7+ mana: 1.

**Support checks:** early 9 (allowed 6-30); board 21 (allowed 16-30); interaction 9 (allowed 3-30); resource 8 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 2 (allowed 2-5); cost:4-5 10 (allowed 6-12); deathrattle 14 (allowed 9-30); large-deathrattle 8 (allowed 4-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Backstab              | 0    |
| 1      | Deadly Poison         | 1    |
| 2      | Eviscerate            | 2    |
| 2      | Haunted Creeper       | 2    |
| 2      | Loot Hoarder          | 2    |
| 1      | Sap                   | 2    |
| 2      | Undercity Huckster    | 2    |
| 1      | Fan of Knives         | 3    |
| 2      | Shadow Strike         | 3    |
| 1      | SI:7 Agent            | 3    |
| 2      | Unearthed Raptor      | 3    |
| 1      | Defender of Argus     | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Tomb Pillager         | 4    |
| 1      | Xaril, Poisoned Mind  | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Sludge Belcher        | 5    |
| 1      | Sylvanas Windrunner   | 6    |
| 1      | N'Zoth, the Corruptor | 10   |

### 3. nzoth-rogue - deathrattle-reload

Seed: **20260917**. Assessment: **Coherent, heavier reload**.

Thirteen Deathrattles include nine substantial bodies. Cairne and Sylvanas both strengthen the late plan; Argus helps the smaller bodies trade or defend.

**Remaining concern:** The four-to-five-mana section is dense. This version may struggle more against fast pressure before its larger threats land.

**Printed mana curve:** 0 mana: 2; 1 mana: 2; 2 mana: 7; 3 mana: 5; 4 mana: 7; 5 mana: 4; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 8 (allowed 6-30); board 22 (allowed 16-30); interaction 8 (allowed 3-30); resource 6 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 3 (allowed 2-5); cost:4-5 11 (allowed 6-12); deathrattle 13 (allowed 9-30); large-deathrattle 9 (allowed 4-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Backstab              | 0    |
| 2      | Deadly Poison         | 1    |
| 2      | Eviscerate            | 2    |
| 2      | Haunted Creeper       | 2    |
| 1      | Sap                   | 2    |
| 2      | Undercity Huckster    | 2    |
| 1      | Fan of Knives         | 3    |
| 2      | SI:7 Agent            | 3    |
| 2      | Unearthed Raptor      | 3    |
| 2      | Defender of Argus     | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Tomb Pillager         | 4    |
| 1      | Xaril, Poisoned Mind  | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Sludge Belcher        | 5    |
| 1      | Cairne Bloodhoof      | 6    |
| 1      | Sylvanas Windrunner   | 6    |
| 1      | N'Zoth, the Corruptor | 10   |

## Warrior

### 1. dragon-warrior - pressure

Seed: **20260915**. Assessment: **Strong tempo identity**.

Eight Dragons enable Champion and Corruptor. Three weapons contest early boards, while damage tools activate Execute and Grommash. Kor'kron and Crushers provide finishing pressure.

**Remaining concern:** Dragon retention and damage sequencing remain important. This is proactive and has little recovery if the board is lost.

**Printed mana curve:** 1 mana: 2; 2 mana: 8; 3 mana: 6; 4 mana: 7; 5 mana: 4; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 10 (allowed 6-30); board 23 (allowed 16-30); interaction 11 (allowed 3-30); resource 4 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 3 (allowed 1-4); cost:4-5 11 (allowed 6-12); tribe:Dragon 8 (allowed 8-30); weapon 3 (allowed 3-4); friendly-damage 5 (allowed 2-30).

| Copies | Card                   | Mana |
| ------ | ---------------------- | ---- |
| 2      | Execute                | 1    |
| 2      | Alexstrasza's Champion | 2    |
| 2      | Faerie Dragon          | 2    |
| 2      | Fiery War Axe          | 2    |
| 2      | Slam                   | 2    |
| 2      | Fierce Monkey          | 3    |
| 2      | Frothing Berserker     | 3    |
| 2      | Ravaging Ghoul         | 3    |
| 2      | Bloodhoof Brave        | 4    |
| 1      | Death's Bite           | 4    |
| 2      | Kor'kron Elite         | 4    |
| 2      | Twilight Guardian      | 4    |
| 2      | Azure Drake            | 5    |
| 2      | Blackwing Corruptor    | 5    |
| 2      | Drakonid Crusher       | 6    |
| 1      | Grommash Hellscream    | 8    |

### 2. dragon-warrior - curator-refill

Seed: **20260916**. Assessment: **Coherent Curator package**.

The underlying Dragon/weapon deck remains intact. Curator has eight Dragons, two useful Fierce Monkeys and Finley as natural targets; no weak off-tribe cards were added solely to fill quotas.

**Remaining concern:** Finley may be drawn before Curator, so three-card refill is not guaranteed. This variant has less immediate pressure than double Kor'kron.

**Printed mana curve:** 1 mana: 5; 2 mana: 8; 3 mana: 4; 4 mana: 5; 5 mana: 4; 6 mana: 2; 7+ mana: 2.

**Support checks:** early 9 (allowed 6-30); board 23 (allowed 16-30); interaction 11 (allowed 3-30); resource 5 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 4 (allowed 1-4); cost:4-5 9 (allowed 6-12); tribe:Dragon 8 (allowed 8-30); weapon 3 (allowed 3-4); friendly-damage 5 (allowed 2-30); tribe:Dragon 8 (allowed 6-30); tribe:Beast 2 (allowed 2-30); tribe:Murloc 1 (allowed 1-30).

| Copies | Card                   | Mana |
| ------ | ---------------------- | ---- |
| 2      | Blood To Ichor         | 1    |
| 2      | Execute                | 1    |
| 1      | Sir Finley Mrrgglton   | 1    |
| 2      | Alexstrasza's Champion | 2    |
| 2      | Faerie Dragon          | 2    |
| 2      | Fiery War Axe          | 2    |
| 2      | Slam                   | 2    |
| 2      | Fierce Monkey          | 3    |
| 2      | Frothing Berserker     | 3    |
| 2      | Bloodhoof Brave        | 4    |
| 1      | Death's Bite           | 4    |
| 2      | Twilight Guardian      | 4    |
| 2      | Azure Drake            | 5    |
| 2      | Blackwing Corruptor    | 5    |
| 2      | Drakonid Crusher       | 6    |
| 1      | The Curator            | 7    |
| 1      | Grommash Hellscream    | 8    |

### 3. dragon-warrior - pressure

Seed: **20260917**. Assessment: **Strong tempo identity**.

The same eight-Dragon core is supported by six reviewed damage activators and three weapons. Ghoul supplies a way to recover against small boards while advancing Execute.

**Remaining concern:** Frothing and Grommash require deliberate attack sequencing; raw legality checks do not establish that the AI will exploit them well.

**Printed mana curve:** 1 mana: 3; 2 mana: 8; 3 mana: 6; 4 mana: 6; 5 mana: 4; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 10 (allowed 6-30); board 23 (allowed 16-30); interaction 12 (allowed 3-30); resource 4 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 3 (allowed 1-4); cost:4-5 10 (allowed 6-12); tribe:Dragon 8 (allowed 8-30); weapon 3 (allowed 3-4); friendly-damage 6 (allowed 2-30).

| Copies | Card                   | Mana |
| ------ | ---------------------- | ---- |
| 1      | Blood To Ichor         | 1    |
| 2      | Execute                | 1    |
| 2      | Alexstrasza's Champion | 2    |
| 2      | Faerie Dragon          | 2    |
| 2      | Fiery War Axe          | 2    |
| 2      | Slam                   | 2    |
| 2      | Fierce Monkey          | 3    |
| 2      | Frothing Berserker     | 3    |
| 2      | Ravaging Ghoul         | 3    |
| 1      | Bloodhoof Brave        | 4    |
| 1      | Death's Bite           | 4    |
| 2      | Kor'kron Elite         | 4    |
| 2      | Twilight Guardian      | 4    |
| 2      | Azure Drake            | 5    |
| 2      | Blackwing Corruptor    | 5    |
| 2      | Drakonid Crusher       | 6    |
| 1      | Grommash Hellscream    | 8    |

## Druid

### 1. cthun-druid - threshold-payoffs

Seed: **20260915**. Assessment: **Coherent C'Thun build**.

Ten buff cards support both Klaxxi copies, Twin Emperor and C'Thun. Early cultists contest the board while ramp and refill move toward the finish.

**Remaining concern:** Ramp can be a poor draw under heavy pressure. Nourish and Darnassus should not be treated as unconditional acceleration regardless of board state.

**Printed mana curve:** 0 mana: 2; 1 mana: 2; 2 mana: 8; 3 mana: 4; 4 mana: 7; 5 mana: 3; 6 mana: 2; 7+ mana: 2.

**Support checks:** early 10 (allowed 4-30); board 21 (allowed 14-30); interaction 10 (allowed 3-30); resource 4 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 4 (allowed 2-5); cost:4-5 10 (allowed 4-10); cthun-buff 10 (allowed 10-30); ramp 7 (allowed 4-30).

| Copies | Card                 | Mana |
| ------ | -------------------- | ---- |
| 2      | Innervate            | 0    |
| 2      | Living Roots         | 1    |
| 2      | Beckoner of Evil     | 2    |
| 2      | Darnassus Aspirant   | 2    |
| 2      | Wild Growth          | 2    |
| 2      | Wrath                | 2    |
| 2      | Disciple of C'Thun   | 3    |
| 2      | Twilight Elder       | 3    |
| 2      | C'Thun's Chosen      | 4    |
| 1      | Keeper of the Grove  | 4    |
| 2      | Klaxxi Amber-Weaver  | 4    |
| 2      | Swipe                | 4    |
| 1      | Azure Drake          | 5    |
| 1      | Druid of the Claw    | 5    |
| 1      | Nourish              | 5    |
| 2      | Dark Arakkoa         | 6    |
| 1      | Twin Emperor Vek'lor | 7    |
| 1      | C'Thun               | 10   |

### 2. yogg-token-druid - token-pressure

Seed: **20260916**. Assessment: **Coherent spell/token build; highest sequencing risk**.

Teacher, Mire Keeper and Living Roots create boards; Power of the Wild, Soul of the Forest and one Savage Roar reward them. Yogg has a genuinely spell-heavy deck behind it.

**Remaining concern:** Few independent early bodies. Teacher/spell order and choosing when to ramp are critical. One Wisps remains an optional, slower board refill; Yogg must not be used to gamble away a winning board.

**Printed mana curve:** 0 mana: 2; 1 mana: 4; 2 mana: 6; 3 mana: 3; 4 mana: 9; 5 mana: 4; 7+ mana: 2.

**Support checks:** early 2 (allowed 2-30); board 15 (allowed 8-30); interaction 6 (allowed 3-30); resource 6 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 2 (allowed 1-3); cost:4-5 13 (allowed 4-14); spell 22 (allowed 18-30); cheap-spell 15 (allowed 10-30); token-source 7 (allowed 6-30); choose-one 17 (allowed 4-30).

| Copies | Card                   | Mana |
| ------ | ---------------------- | ---- |
| 2      | Innervate              | 0    |
| 2      | Living Roots           | 1    |
| 2      | Raven Idol             | 1    |
| 2      | Power of the Wild      | 2    |
| 2      | Wild Growth            | 2    |
| 2      | Wrath                  | 2    |
| 2      | Feral Rage             | 3    |
| 1      | Savage Roar            | 3    |
| 1      | Fandral Staghelm       | 4    |
| 2      | Mire Keeper            | 4    |
| 2      | Soul of the Forest     | 4    |
| 2      | Swipe                  | 4    |
| 2      | Violet Teacher         | 4    |
| 2      | Druid of the Claw      | 5    |
| 2      | Nourish                | 5    |
| 1      | Wisps of the Old Gods  | 7    |
| 1      | Yogg-Saron, Hope's End | 10   |

### 3. cthun-druid - flexible-curve

Seed: **20260917**. Assessment: **Coherent flexible C'Thun build**.

The ten-card buff package and Twin Emperor remain fixed. Fandral has eight Choose One cards, with removal, healing/attack choices and draw offering useful flexibility.

**Remaining concern:** This variant has fewer threshold bodies than the first sample; its advantage depends more on using flexible cards well.

**Printed mana curve:** 0 mana: 2; 1 mana: 1; 2 mana: 7; 3 mana: 6; 4 mana: 6; 5 mana: 4; 6 mana: 2; 7+ mana: 2.

**Support checks:** early 8 (allowed 4-30); board 19 (allowed 14-30); interaction 9 (allowed 3-30); resource 5 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 4 (allowed 2-5); cost:4-5 10 (allowed 4-10); cthun-buff 10 (allowed 10-30); ramp 6 (allowed 4-30); choose-one 8 (allowed 4-30).

| Copies | Card                 | Mana |
| ------ | -------------------- | ---- |
| 2      | Innervate            | 0    |
| 1      | Living Roots         | 1    |
| 2      | Beckoner of Evil     | 2    |
| 1      | Darnassus Aspirant   | 2    |
| 2      | Wild Growth          | 2    |
| 2      | Wrath                | 2    |
| 2      | Disciple of C'Thun   | 3    |
| 2      | Feral Rage           | 3    |
| 2      | Twilight Elder       | 3    |
| 2      | C'Thun's Chosen      | 4    |
| 1      | Fandral Staghelm     | 4    |
| 1      | Keeper of the Grove  | 4    |
| 2      | Swipe                | 4    |
| 2      | Azure Drake          | 5    |
| 1      | Druid of the Claw    | 5    |
| 1      | Nourish              | 5    |
| 2      | Dark Arakkoa         | 6    |
| 1      | Twin Emperor Vek'lor | 7    |
| 1      | C'Thun               | 10   |

## Paladin

### 1. secret-paladin - pressure

Seed: **20260915**. Assessment: **Strong Secret Paladin identity**.

Both Challengers, six secrets, Minibots and Muster define the curve. Loatheb, Dr. Boom and Tirion are supporting follow-ups, not randomly chosen identities.

**Remaining concern:** Divine Favor is conditional refill. Drawing several secrets before Challenger can still produce a weak hand; this is an inherent package risk.

**Printed mana curve:** 1 mana: 8; 2 mana: 5; 3 mana: 5; 4 mana: 5; 5 mana: 3; 6 mana: 2; 7+ mana: 2.

**Support checks:** early 10 (allowed 6-30); board 19 (allowed 16-30); interaction 4 (allowed 3-30); resource 1 (allowed 1-30); cost:8+ 1 (allowed 0-1); cost:6+ 4 (allowed 2-5); cost:4-5 8 (allowed 6-12); secret 6 (allowed 6-6); weapon 3 (allowed 1-3).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Avenge                | 1    |
| 1      | Competitive Spirit    | 1    |
| 2      | Noble Sacrifice       | 1    |
| 1      | Redemption            | 1    |
| 2      | Secretkeeper          | 1    |
| 1      | Haunted Creeper       | 2    |
| 2      | Knife Juggler         | 2    |
| 2      | Shielded Minibot      | 2    |
| 1      | Aldor Peacekeeper     | 3    |
| 1      | Coghammer             | 3    |
| 1      | Divine Favor          | 3    |
| 2      | Muster for Battle     | 3    |
| 1      | Consecration          | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Truesilver Champion   | 4    |
| 1      | Loatheb               | 5    |
| 2      | Sludge Belcher        | 5    |
| 2      | Mysterious Challenger | 6    |
| 1      | Dr. Boom              | 7    |
| 1      | Tirion Fordring       | 8    |

### 2. recruit-paladin - recruits

Seed: **20260916**. Assessment: **Coherent slower Recruit Midrange**.

Muster, Quartermaster and Justicar share a clear plan. Equality plus two Consecrations supplies recovery, while Azure Drakes and Lay on Hands provide refill.

**Remaining concern:** Two eight-cost cards make this the slower Paladin variant. Lay on Hands is deliberate recovery rather than another oversized threat, but early pressure still matters.

**Printed mana curve:** 1 mana: 2; 2 mana: 7; 3 mana: 5; 4 mana: 7; 5 mana: 5; 6 mana: 1; 7+ mana: 3.

**Support checks:** early 12 (allowed 6-30); board 23 (allowed 16-30); interaction 5 (allowed 3-30); resource 3 (allowed 2-30); cost:8+ 2 (allowed 0-2); cost:6+ 4 (allowed 2-5); cost:4-5 12 (allowed 6-12); recruit-source 2 (allowed 2-30); weapon 3 (allowed 1-3).

| Copies | Card                | Mana |
| ------ | ------------------- | ---- |
| 2      | Zombie Chow         | 1    |
| 1      | Equality            | 2    |
| 2      | Haunted Creeper     | 2    |
| 2      | Knife Juggler       | 2    |
| 2      | Shielded Minibot    | 2    |
| 2      | Aldor Peacekeeper   | 3    |
| 1      | Coghammer           | 3    |
| 2      | Muster for Battle   | 3    |
| 2      | Consecration        | 4    |
| 1      | Murloc Knight       | 4    |
| 2      | Piloted Shredder    | 4    |
| 2      | Truesilver Champion | 4    |
| 2      | Azure Drake         | 5    |
| 2      | Quartermaster       | 5    |
| 1      | Sludge Belcher      | 5    |
| 1      | Justicar Trueheart  | 6    |
| 1      | Dr. Boom            | 7    |
| 1      | Lay on Hands        | 8    |
| 1      | Tirion Fordring     | 8    |

### 3. secret-paladin - resilience

Seed: **20260917**. Assessment: **Coherent resilient Secret Paladin**.

The full Challenger package remains intact, backed by Creepers, Belchers and Drakes. Three weapons meet the cap and avoid the earlier overload of weapon slots.

**Remaining concern:** No Consecration or Dr. Boom in this draw. Wide enemy boards can be harder to recover from, and winning relies more on maintained tempo.

**Printed mana curve:** 1 mana: 6; 2 mana: 6; 3 mana: 6; 4 mana: 5; 5 mana: 4; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 10 (allowed 6-30); board 19 (allowed 16-30); interaction 3 (allowed 3-30); resource 3 (allowed 1-30); cost:8+ 1 (allowed 0-1); cost:6+ 3 (allowed 2-5); cost:4-5 9 (allowed 6-12); secret 6 (allowed 6-6); weapon 3 (allowed 1-3).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Avenge                | 1    |
| 1      | Competitive Spirit    | 1    |
| 2      | Noble Sacrifice       | 1    |
| 1      | Redemption            | 1    |
| 2      | Haunted Creeper       | 2    |
| 2      | Knife Juggler         | 2    |
| 2      | Shielded Minibot      | 2    |
| 2      | Aldor Peacekeeper     | 3    |
| 1      | Coghammer             | 3    |
| 1      | Divine Favor          | 3    |
| 2      | Muster for Battle     | 3    |
| 1      | Blessing of Kings     | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Truesilver Champion   | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Sludge Belcher        | 5    |
| 2      | Mysterious Challenger | 6    |
| 1      | Tirion Fordring       | 8    |

## Priest

### 1. dragon-priest - dragon-value

Seed: **20260915**. Assessment: **Strong Dragon package**.

Eleven Dragons support the conditional early bodies, Corruptors, Operatives and Book Wyrms. Cleric, healing and buffs reward favorable trades; Ysera supplies a late option.

**Remaining concern:** Substantial discovery/draw can slow AI turns. Some threats and removal are conditional on keeping a Dragon in hand.

**Printed mana curve:** 1 mana: 6; 2 mana: 5; 3 mana: 7; 4 mana: 2; 5 mana: 6; 6 mana: 3; 7+ mana: 1.

**Support checks:** early 12 (allowed 6-30); board 23 (allowed 16-30); interaction 7 (allowed 3-30); resource 11 (allowed 2-30); cost:8+ 1 (allowed 0-1); cost:6+ 4 (allowed 2-4); cost:4-5 8 (allowed 6-12); tribe:Dragon 11 (allowed 9-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Northshire Cleric     | 1    |
| 2      | Power Word: Shield    | 1    |
| 2      | Twilight Whelp        | 1    |
| 2      | Netherspite Historian | 2    |
| 1      | Shadow Word: Pain     | 2    |
| 2      | Wyrmrest Agent        | 2    |
| 1      | Blackwing Technician  | 3    |
| 1      | Brann Bronzebeard     | 3    |
| 2      | Kabal Talonpriest     | 3    |
| 1      | Shadow Word: Death    | 3    |
| 2      | Velen's Chosen        | 3    |
| 2      | Twilight Guardian     | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Blackwing Corruptor   | 5    |
| 2      | Drakonid Operative    | 5    |
| 2      | Book Wyrm             | 6    |
| 1      | Dragonfire Potion     | 6    |
| 1      | Ysera                 | 9    |

### 2. dragon-priest - board-tempo

Seed: **20260916**. Assessment: **Strong board-oriented variant**.

Ten Dragons, Talonpriests and Velen's Chosen favor durable early boards. Holy Nova and Dragonfire Potion provide recovery without an extra nine-cost threat.

**Remaining concern:** Less dedicated late-game finishing power than the Ysera sample. Refill and favorable trades must sustain pressure.

**Printed mana curve:** 1 mana: 6; 2 mana: 4; 3 mana: 7; 4 mana: 2; 5 mana: 8; 6 mana: 3.

**Support checks:** early 11 (allowed 6-30); board 21 (allowed 16-30); interaction 9 (allowed 3-30); resource 9 (allowed 2-30); cost:8+ 0 (allowed 0-1); cost:6+ 3 (allowed 2-4); cost:4-5 10 (allowed 6-12); tribe:Dragon 10 (allowed 9-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Northshire Cleric     | 1    |
| 2      | Power Word: Shield    | 1    |
| 2      | Twilight Whelp        | 1    |
| 1      | Netherspite Historian | 2    |
| 1      | Shadow Word: Pain     | 2    |
| 2      | Wyrmrest Agent        | 2    |
| 1      | Blackwing Technician  | 3    |
| 1      | Brann Bronzebeard     | 3    |
| 2      | Kabal Talonpriest     | 3    |
| 1      | Shadow Word: Death    | 3    |
| 2      | Velen's Chosen        | 3    |
| 2      | Twilight Guardian     | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Blackwing Corruptor   | 5    |
| 2      | Drakonid Operative    | 5    |
| 2      | Holy Nova             | 5    |
| 2      | Book Wyrm             | 6    |
| 1      | Dragonfire Potion     | 6    |

### 3. dragon-priest - dragon-value

Seed: **20260917**. Assessment: **Coherent defensive Dragon variant**.

Ten Dragons still support all key payoffs. Two Holy Novas and two Dragonfire Potions provide more board recovery within the four-card late-cost cap.

**Remaining concern:** The extra clears can be awkward against slow opponents. Dragonfire also kills this deck's non-Dragon support minions, so it must be timed carefully.

**Printed mana curve:** 1 mana: 6; 2 mana: 5; 3 mana: 5; 4 mana: 2; 5 mana: 8; 6 mana: 4.

**Support checks:** early 10 (allowed 6-30); board 20 (allowed 16-30); interaction 10 (allowed 3-30); resource 10 (allowed 2-30); cost:8+ 0 (allowed 0-1); cost:6+ 4 (allowed 2-4); cost:4-5 10 (allowed 6-12); tribe:Dragon 10 (allowed 9-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Northshire Cleric     | 1    |
| 2      | Power Word: Shield    | 1    |
| 2      | Twilight Whelp        | 1    |
| 2      | Netherspite Historian | 2    |
| 1      | Shadow Word: Pain     | 2    |
| 2      | Wyrmrest Agent        | 2    |
| 1      | Brann Bronzebeard     | 3    |
| 1      | Kabal Talonpriest     | 3    |
| 1      | Shadow Word: Death    | 3    |
| 2      | Velen's Chosen        | 3    |
| 2      | Twilight Guardian     | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Blackwing Corruptor   | 5    |
| 2      | Drakonid Operative    | 5    |
| 2      | Holy Nova             | 5    |
| 2      | Book Wyrm             | 6    |
| 2      | Dragonfire Potion     | 6    |

## Mage

### 1. mech-mage - sticky-mechs

Seed: **20260915**. Assessment: **Strong Mech tempo identity**.

Thirteen Mechs consistently support both Blastmages and Technicians. Mechwarper enables development; burn, Dr. Boom and Loatheb give a clear close-out plan.

**Remaining concern:** Mechanical Yeti also gives the opponent a Spare Part. The heavier four-to-five-mana section needs early Mechs to preserve tempo.

**Printed mana curve:** 1 mana: 2; 2 mana: 7; 3 mana: 8; 4 mana: 8; 5 mana: 3; 7+ mana: 2.

**Support checks:** early 13 (allowed 6-30); board 23 (allowed 16-30); interaction 7 (allowed 3-30); resource 10 (allowed 2-30); cost:8+ 0 (allowed 0-1); cost:6+ 2 (allowed 1-3); cost:4-5 11 (allowed 6-12); tribe:Mech 13 (allowed 12-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Clockwork Gnome       | 1    |
| 1      | Annoy-o-Tron          | 2    |
| 2      | Frostbolt             | 2    |
| 2      | Mechwarper            | 2    |
| 2      | Snowchugger           | 2    |
| 2      | Arcane Intellect      | 3    |
| 2      | Harvest Golem         | 3    |
| 2      | Spider Tank           | 3    |
| 2      | Tinkertown Technician | 3    |
| 2      | Fireball              | 4    |
| 2      | Goblin Blastmage      | 4    |
| 2      | Mechanical Yeti       | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Azure Drake           | 5    |
| 1      | Loatheb               | 5    |
| 1      | Dr. Boom              | 7    |
| 1      | Flamestrike           | 7    |

### 2. flamewaker-mage - board-tempo

Seed: **20260916**. Assessment: **Strong Flamewaker tempo identity**.

Twelve cheap spells and fifteen total spells support Wyrm, Apprentice and Flamewaker. Water Elemental and Summoner preserve board presence when spell payoffs are absent.

**Remaining concern:** Spell timing remains important. Mirror Image and Arcane Missiles are situational; the AI should not spend them just to increase trigger counts.

**Printed mana curve:** 1 mana: 10; 2 mana: 7; 3 mana: 4; 4 mana: 4; 5 mana: 2; 6 mana: 2; 7+ mana: 1.

**Support checks:** early 11 (allowed 6-30); board 17 (allowed 10-30); interaction 11 (allowed 3-30); resource 7 (allowed 2-30); cost:8+ 0 (allowed 0-1); cost:6+ 3 (allowed 1-3); cost:4-5 6 (allowed 3-8); cheap-spell 12 (allowed 10-30); spell 15 (allowed 14-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Arcane Blast          | 1    |
| 2      | Arcane Missiles       | 1    |
| 2      | Babbling Book         | 1    |
| 2      | Mana Wyrm             | 1    |
| 2      | Mirror Image          | 1    |
| 1      | Bloodmage Thalnos     | 2    |
| 2      | Flamecannon           | 2    |
| 2      | Frostbolt             | 2    |
| 2      | Sorcerer's Apprentice | 2    |
| 2      | Arcane Intellect      | 3    |
| 2      | Flamewaker            | 3    |
| 2      | Fireball              | 4    |
| 2      | Water Elemental       | 4    |
| 2      | Azure Drake           | 5    |
| 2      | Faceless Summoner     | 6    |
| 1      | Flamestrike           | 7    |

### 3. mech-mage - spare-parts

Seed: **20260917**. Assessment: **Coherent Mech/spare-parts variant**.

Thirteen Mechs support the normal tempo core. Gnomes, Technicians, Yetis and Toshley provide cheap generated spells for Antonidas; the engine is supported by actual sources.

**Remaining concern:** More demanding than the first Mech sample. Keeping too many Spare Parts for Antonidas could sacrifice tempo, and generated cards add choice overhead.

**Printed mana curve:** 1 mana: 2; 2 mana: 7; 3 mana: 7; 4 mana: 8; 5 mana: 3; 6 mana: 1; 7+ mana: 2.

**Support checks:** early 12 (allowed 6-30); board 24 (allowed 16-30); interaction 6 (allowed 3-30); resource 12 (allowed 2-30); cost:8+ 0 (allowed 0-1); cost:6+ 3 (allowed 1-3); cost:4-5 11 (allowed 6-12); tribe:Mech 13 (allowed 12-30).

| Copies | Card                  | Mana |
| ------ | --------------------- | ---- |
| 2      | Clockwork Gnome       | 1    |
| 1      | Annoy-o-Tron          | 2    |
| 2      | Frostbolt             | 2    |
| 2      | Mechwarper            | 2    |
| 2      | Snowchugger           | 2    |
| 2      | Arcane Intellect      | 3    |
| 1      | Harvest Golem         | 3    |
| 2      | Spider Tank           | 3    |
| 2      | Tinkertown Technician | 3    |
| 2      | Fireball              | 4    |
| 2      | Goblin Blastmage      | 4    |
| 2      | Mechanical Yeti       | 4    |
| 2      | Piloted Shredder      | 4    |
| 2      | Azure Drake           | 5    |
| 1      | Loatheb               | 5    |
| 1      | Toshley               | 6    |
| 1      | Archmage Antonidas    | 7    |
| 1      | Dr. Boom              | 7    |

## Shaman

### 1. totem-shaman - spell-damage

Seed: **20260915**. Assessment: **Strong Totem/Overload identity**.

Seven totem sources and seven Overload cards support Trogg, Thing from Below and Valiant. Both Claws have three spell-damage minions; a single Bloodlust supplies finishing reach.

**Remaining concern:** Overload can obstruct the next turn. Flametongue positioning and the timing of Valiant plus hero power determine how well the deck converts a board into damage.

**Printed mana curve:** 1 mana: 4; 2 mana: 7; 3 mana: 8; 4 mana: 2; 5 mana: 5; 6 mana: 4.

**Support checks:** early 8 (allowed 6-30); board 20 (allowed 16-30); interaction 9 (allowed 3-30); resource 5 (allowed 3-30); cost:8+ 0 (allowed 0-1); cost:6+ 4 (allowed 2-5); cost:4-5 7 (allowed 6-12); totem 7 (allowed 5-30); overload 7 (allowed 6-30); spell-damage 3 (allowed 3-30); totem 7 (allowed 5-30).

| Copies | Card                   | Mana |
| ------ | ---------------------- | ---- |
| 2      | Spirit Claws           | 1    |
| 2      | Tunnel Trogg           | 1    |
| 1      | Bloodmage Thalnos      | 2    |
| 2      | Flametongue Totem      | 2    |
| 2      | Maelstrom Portal       | 2    |
| 2      | Totem Golem            | 2    |
| 2      | Feral Spirit           | 3    |
| 2      | Hex                    | 3    |
| 1      | Lightning Storm        | 3    |
| 2      | Mana Tide Totem        | 3    |
| 1      | Tuskarr Totemic        | 3    |
| 2      | Flamewreathed Faceless | 4    |
| 2      | Azure Drake            | 5    |
| 1      | Bloodlust              | 5    |
| 2      | Thunder Bluff Valiant  | 5    |
| 2      | Fire Elemental         | 6    |
| 2      | Thing from Below       | 6    |

### 2. jade-shaman - jade-value

Seed: **20260916**. Assessment: **Strong Jade midrange identity**.

Nine Jade cards grow threats while Claws and Lightning contest the board. Brann has useful Jade battlecries, and substantial interaction protects development.

**Remaining concern:** Five cards cost six or more. This sample can be slow if its early Trogg/Golem/Claws opening is missing; Brann should not cause the AI to hoard all Jade cards.

**Printed mana curve:** 1 mana: 4; 2 mana: 8; 3 mana: 7; 4 mana: 4; 5 mana: 2; 6 mana: 3; 7+ mana: 2.

**Support checks:** early 6 (allowed 4-30); board 21 (allowed 14-30); interaction 13 (allowed 3-30); resource 4 (allowed 2-30); cost:8+ 0 (allowed 0-1); cost:6+ 5 (allowed 2-5); cost:4-5 6 (allowed 6-12); jade 9 (allowed 8-30); totem 7 (allowed 3-30).

| Copies | Card              | Mana |
| ------ | ----------------- | ---- |
| 2      | Lightning Bolt    | 1    |
| 2      | Tunnel Trogg      | 1    |
| 2      | Flametongue Totem | 2    |
| 2      | Jade Claws        | 2    |
| 2      | Maelstrom Portal  | 2    |
| 2      | Totem Golem       | 2    |
| 1      | Brann Bronzebeard | 3    |
| 2      | Hex               | 3    |
| 1      | Lightning Storm   | 3    |
| 2      | Mana Tide Totem   | 3    |
| 1      | Tuskarr Totemic   | 3    |
| 2      | Jade Lightning    | 4    |
| 2      | Jade Spirit       | 4    |
| 2      | Azure Drake       | 5    |
| 1      | Aya Blackpaw      | 6    |
| 2      | Fire Elemental    | 6    |
| 2      | Jade Chieftain    | 7    |

### 3. totem-shaman - board-pressure

Seed: **20260917**. Assessment: **Strong board-oriented Totem variant**.

Eight totem sources and seven Overload cards keep the core coherent. Bloodlust is capped at one, and the optional Claws still receives three spell-damage minions.

**Remaining concern:** Several cards need an existing board or future hero-power use. Trading all totems away carelessly can erase the deck's payoff advantage.

**Printed mana curve:** 1 mana: 3; 2 mana: 7; 3 mana: 9; 4 mana: 2; 5 mana: 5; 6 mana: 4.

**Support checks:** early 9 (allowed 6-30); board 21 (allowed 16-30); interaction 8 (allowed 3-30); resource 5 (allowed 3-30); cost:8+ 0 (allowed 0-1); cost:6+ 4 (allowed 2-5); cost:4-5 7 (allowed 6-12); totem 8 (allowed 5-30); overload 7 (allowed 6-30); spell-damage 3 (allowed 3-30); totem 8 (allowed 5-30).

| Copies | Card                   | Mana |
| ------ | ---------------------- | ---- |
| 1      | Spirit Claws           | 1    |
| 2      | Tunnel Trogg           | 1    |
| 1      | Bloodmage Thalnos      | 2    |
| 2      | Flametongue Totem      | 2    |
| 2      | Maelstrom Portal       | 2    |
| 2      | Totem Golem            | 2    |
| 2      | Feral Spirit           | 3    |
| 2      | Hex                    | 3    |
| 1      | Lightning Storm        | 3    |
| 2      | Mana Tide Totem        | 3    |
| 2      | Tuskarr Totemic        | 3    |
| 2      | Flamewreathed Faceless | 4    |
| 2      | Azure Drake            | 5    |
| 1      | Bloodlust              | 5    |
| 2      | Thunder Bluff Valiant  | 5    |
| 2      | Fire Elemental         | 6    |
| 2      | Thing from Below       | 6    |

## Reproduction and artifacts

The adjacent JSON stores each exact deck, seed, selected archetype/variant, requirements and generation options. Use `generateConstructedOpponent(seed, options)` against generator version 3 and the same catalog. The human deck never participates in selection. Generated opponents are not saved into the player's collection.

## Historical package references

- [Secret Midrange Paladin](https://www.vicioussyndicate.com/coradin/)
- [Silver Hand Midrange Paladin](https://gazettereview.com/2016/01/top-heartstone-decks-2016/)
- [Totem / Overload Midrange Shaman](https://www.hearthstonetopdecks.com/decks/midrange-shaman-decklist-guide-standard-may-2016-season-26/)
- [Jade Midrange Shaman](https://www.vicioussyndicate.com/vs-data-reaper-report-31/)
- [Beast Midrange Hunter](https://www.vicioussyndicate.com/vs-data-reaper-report-5/)
- [N'Zoth Deathrattle Hunter](https://www.vicioussyndicate.com/vs-data-reaper-report-5/)
- [C'Thun Midrange Druid](https://www.hearthstonetopdecks.com/decks/gamekings-cthun-druid-hearthstone-eu-spring-prelims-2016/)
- [Yogg Token Druid](https://www.hearthpwn.com/decks/562644-yogg-token-druid-guide-by-j4ckiechan)
- [Dragon Midrange Priest](https://www.vicioussyndicate.com/vs-data-reaper-report-31/)
- [Dragon Tempo Warrior](https://www.vicioussyndicate.com/top-8-recap-world-championship-2016/)
- [Mech Tempo Mage](https://www.hearthpwn.com/decks/238827-budget-mech-mage-no-secrets)
- [Flamewaker Tempo Mage](https://www.reddit.com/r/CompetitiveHS/comments/401m7m/tempo_mage/)
- [N'Zoth Raptor Midrange Rogue](https://www.hipstersofthecoast.com/2016/09/look-hearthstones-recipe-decks/)
- [Demon Midrange Warlock](https://teamarchon.com/decks/view/13-midrange-warlock/)
