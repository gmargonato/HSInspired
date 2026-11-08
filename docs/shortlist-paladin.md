# Shortlisted Paladin and neutral cards

This package implements the selected historical renders, not current balance values. It contains 16 collectible cards and three uncollectible tokens. No artwork changes are required.

## Content and implementation choices

- Ashes of Outland: Aldor Attendant, Aldor Truthseeker, Libram of Wisdom, Libram of Justice, Libram of Hope, and Ancient Guardian.
- The Boomsday Project: Crystology.
- United in Stormwind: Alliance Bannerman and Battleground Battlemaster.
- Whizbang's Workshop: Painter's Virtue.
- The Witchwood: Vicious Scalehide.
- Showdown in the Badlands: Hi Ho Silverwing, Gold Panner, Showdown!, Prismatic Beam, and Outlaw.
- Into the Emerald Dream: Mother Duck and Duckling.
- Perils in Paradise (Traveling Travel Agency mini-set): Busy-Bot.

Every record belongs to Future Past. The historical expansions listed above identify the source versions, not Collection categories. Existing card IDs and artwork names are preserved. The original Librams are used: Wisdom returns through an attached Deathrattle and the Aldors reduce Libram costs for the rest of the game. Bannerman is 3 mana 2/2; Battlemaster is 6 mana; Beam is 7 mana and damages all enemy characters, including the hero. No spell school is inferred when absent from the selected render.

Permanent Libram discounts use existing non-consuming pending cost modifiers, one exact card-ID filter per implemented Libram. They stack, survive the source leaving play, survive checkpoint restoration, and affect future copies. Adding another Libram later must extend those three-card filter lists or introduce a general family selector with tests.

Justice reuses the existing `classic_lights_justice` 1/4 weapon instead of creating a duplicate weapon. Ancient Guardian is an 8-mana Paladin 8/8 with Taunt and Divine Shield. Outlaw is a 3-mana Paladin 3/3 without printed Rush; Showdown grants Rush only to the friendly Outlaws summoned by that cast. Duckling is a 1-mana neutral Beast 1/1 with Rush. Tokens are not collectible or deck-legal.

Token metadata was checked against [Ancient Guardian](https://hearthstone.wiki.gg/wiki/Ancient_Guardian), [Outlaw](https://hearthstone.wiki.gg/wiki/Outlaw), and [Duckling](https://hearthstone.wiki.gg/wiki/Duckling). Justice's existing-weapon behavior is corroborated by the [Vicious Syndicate Ashes of Outland review](https://www.vicioussyndicate.com/the-comprehensive-ashes-of-outland-preview/5/). These checks fill missing token metadata; they do not override the user's selected main-card balance values.

## Durable executable scenarios

Run:

```sh
npx vitest run src/game-rules/match/effects/shortlist-paladin.scenarios.ts
```

The suite runs through the real catalog and match command boundary, with deterministic fixtures and no mock effects. It contains 31 scenarios:

| Card or interaction             | Assertions                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aldor Attendant and Truthseeker | Reductions stack on held and generated copies, Wisdom stops at zero, Truthseeker has Taunt, returned Wisdom retains discounts.                                                                                                                                                   |
| Persistent Libram discounts     | Source death and two turn changes do not remove discounts; checkpoint restoration retains them for newly generated copies.                                                                                                                                                       |
| Libram of Wisdom                | Buffs stack, both attached Deathrattles return a spell, and Silence removes both the stats and returns.                                                                                                                                                                          |
| Wisdom copying and ownership    | Faceless Manipulator copies the granted Deathrattle; buffing an enemy returns the spell to that minion's controller.                                                                                                                                                             |
| Wisdom hand cap                 | Two Deathrattles with nine cards in hand produce only one retained return.                                                                                                                                                                                                       |
| Libram of Justice               | Replaces an existing weapon, sets enemy health before Wild Pyromancer's after-spell damage, and preserves friendly health.                                                                                                                                                       |
| Justice versus Divine Shield    | Health becomes one while Divine Shield remains intact.                                                                                                                                                                                                                           |
| Libram of Hope                  | Heals the chosen hero up to 30 and summons the 8/8 Taunt/Divine Shield Guardian; on a full board healing still happens without an eighth minion.                                                                                                                                 |
| Crystology                      | Draws exactly the qualifying one-attack minions, skips spells and other attacks, and a tutor miss does not fatigue.                                                                                                                                                              |
| Alliance Bannerman              | Draw precedes handbuff, so the newly drawn minion is buffed along with existing minions; spells are unaffected.                                                                                                                                                                  |
| Painter's Virtue                | Hero attacks heal, reduce durability and buff hand minions; the final durability attack still buffs, and a replacement weapon does not retain the effect.                                                                                                                        |
| Painter's overkill              | Two damage into a one-health minion heals two, with retaliation accounted for, and still buffs the hand.                                                                                                                                                                         |
| Vicious Scalehide               | Rush allows immediate minion attacks but not hero attacks, and combat damage heals. Buffed overkill heals full attack rather than remaining victim health.                                                                                                                       |
| Hi Ho Silverwing                | Divine Shield is present; Deathrattle draws Holy only, excluding other spells and minions.                                                                                                                                                                                       |
| Gold Panner                     | Draws at the end of its controller's turn.                                                                                                                                                                                                                                       |
| Mother Duck                     | Creates three Rush Ducklings, or only the available slots when the board is almost full.                                                                                                                                                                                         |
| Busy-Bot                        | Buffs only friendly minions currently at one attack.                                                                                                                                                                                                                             |
| Showdown!                       | Independent seven-minion caps on each board; friendly summons are emitted before enemy summons; only newly created friendly Outlaws get Rush.                                                                                                                                    |
| Prismatic Beam                  | Live cost responds to enemy board population from seven to zero; friendly minions do not discount it; damage includes enemy hero and excludes friendlies.                                                                                                                        |
| Battleground Battlemaster       | Only immediate neighbors gain Windfury; real second attacks work, and two ready Giants deliver four attacks for lethal. Silence, source death and changed adjacency revoke the benefit. Mega-Windfury takes precedence, and independently granted extra attacks remain additive. |
| Selected-render regression      | Explicit assertions lock Beam at 7, Bannerman at 3 mana 2/2, and Battlemaster at 6.                                                                                                                                                                                              |

All 31 scenarios passed after integration. A focused engine correction now publishes the Windfury attack limit when continuous keyword auras apply; previously the keyword was visible but the cached attack limit remained one. Overkill Lifesteal scenarios also exercise the shared runtime correction implemented with the other shortlisted cards.
