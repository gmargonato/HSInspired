# Future Past: Yore Warlock implementation contract

Verified against card records on 2026-10-19. This is a 30-card local fixture for testing and later refinement, not a claim of competitive strength. No user-profile deck is inserted automatically.

## Approved versions and boundaries

- Cursed Catacombs intentionally uses its original 0-mana, minion-only version, rather than the later any-other-card version.
- Ancient of Yore is 5 mana, 5/5, no tribe, Dormant for 2 turns, with 3 Armor and one draw at each own end of turn while Dormant.
- Puppetmaster Dorian is 5 mana, 2/6, and generates a 1-mana 1/1 copy in hand, not on the battlefield.
- Agamaggan is 10 mana, 9/9 Beast. Its Battlecry affects the next card of any type and persists across turns until used.
- Fyrakk is 10 mana, 7/7 Dragon, with a 15-mana Fire-spell budget. Fire-spell immunity is intentionally omitted at the user's request.
- Bob uses the current Recruit a Minion option: copy the enemy minion; do not remove it.
- Shaladrassil uses the current 8-mana version. Dream tokens are separate Future Past definitions so existing Classic card tuning stays unchanged.
- Locations, Reborn, Kerrigan, Tourist, and custom Eternal Layover are excluded. Existing artwork fallback is accepted.

## Fixture

`future-past-yore-deck.json` is a version-2 deck record with 30 cards, Gul'dan, and legal copy counts. Glacial Shard, Defile, and Drain Soul reuse existing catalog definitions.

## Authored card specification

| Card                   | Mana | Stats / tribe | Class   | Rarity    | Rules text                                                                                           | Reference                                                              |
| ---------------------- | ---: | ------------- | ------- | --------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cursed Catacombs       |    0 | Spell         | Warlock | Epic      | Discover a minion from your deck. Make it Temporary.                                                 | [Card record](https://hearthstone.wiki.gg/wiki/Cursed_Catacombs)       |
| Dark Pact              |    1 | Spell         | Warlock | Common    | Destroy a friendly minion. Restore 8 Health to your hero.                                            | [Card record](https://hearthstone.wiki.gg/wiki/Dark_Pact)              |
| Touch of the Nathrezim |    1 | Spell         | Warlock | Rare      | Deal 2 damage to a minion. If it dies, restore 3 Health to your hero.                                | [Card record](https://hearthstone.wiki.gg/wiki/Touch_of_the_Nathrezim) |
| Shallow Grave          |    2 | Spell         | Warlock | Epic      | Trigger a friendly minion's Deathrattle, then destroy it.                                            | [Card record](https://hearthstone.wiki.gg/wiki/Shallow_Grave)          |
| Cursed Campaign        |    3 | Spell         | Warlock | Epic      | Give a friendly minion "Deathrattle: Summon two copies of this minion that are Dormant for 2 turns." | [Card record](https://hearthstone.wiki.gg/wiki/Cursed_Campaign)        |
| Domino Effect          |    3 | Spell         | Warlock | Rare      | Deal 2 damage to a minion. Repeat to the left or right, dealing 1 more damage each time.             | [Card record](https://hearthstone.wiki.gg/wiki/Domino_Effect)          |
| Ancient of Yore        |    5 | 5/5           | Neutral | Epic      | Dormant for 2 turns. While Dormant, gain 3 Armor and draw a card at the end of your turn.            | [Card record](https://hearthstone.wiki.gg/wiki/Ancient_of_Yore)        |
| Table Flip             |   10 | Spell         | Warlock | Common    | Deal 3 damage to all enemy minions. Costs (1) less for each other card in your hand.                 | [Card record](https://hearthstone.wiki.gg/wiki/Table_Flip)             |
| Raise Dead             |    0 | Spell         | Warlock | Common    | Deal 3 damage to your hero. Return two friendly minions that died this game to your hand.            | [Card record](https://hearthstone.wiki.gg/wiki/Raise_Dead)             |
| Maiev Shadowsong       |    4 | 4/3           | Neutral | Legendary | Battlecry: Choose a minion. It goes Dormant for 2 turns.                                             | [Card record](https://hearthstone.wiki.gg/wiki/Maiev_Shadowsong)       |
| Carnivorous Cube       |    5 | 4/6           | Neutral | Epic      | Battlecry: Destroy a friendly minion. Deathrattle: Summon 2 copies of it.                            | [Card record](https://hearthstone.wiki.gg/wiki/Carnivorous_Cube)       |
| Puppetmaster Dorian    |    5 | 2/6           | Neutral | Legendary | Whenever you draw a minion, get a 1/1 copy of it that costs (1).                                     | [Card record](https://hearthstone.wiki.gg/wiki/Puppetmaster_Dorian)    |
| Bob the Bartender      |    6 | 4/5           | Neutral | Legendary | Battlecry: Choose an action from the Battlegrounds!                                                  | [Card record](https://hearthstone.wiki.gg/wiki/Bob_the_Bartender)      |
| Shaladrassil           |    8 | Spell         | Neutral | Legendary | Get all 5 Dream cards. If you've played a higher Cost card while holding this, corrupt them!         | [Card record](https://hearthstone.wiki.gg/wiki/Shaladrassil)           |
| Agamaggan              |   10 | 9/9 Beast     | Warlock | Legendary | Battlecry: The next card you play costs your OPPONENT'S Health instead of Mana (up to 10).           | [Card record](https://hearthstone.wiki.gg/wiki/Agamaggan)              |
| Fyrakk the Blazing     |   10 | 7/7 Dragon    | Neutral | Legendary | Battlecry: Cast 15 Mana worth of Fire spells at random enemies.                                      | [Card record](https://hearthstone.wiki.gg/wiki/Fyrakk_the_Blazing)     |

## Bob choices

Recruit copies from battlefield to hand reset damage and ordinary enchantments. A buffed, damaged Chillwind Yeti therefore produces a base 4/5 in hand; the original enemy minion is unchanged. This follows the [copy zone-transition rule](https://hearthstone.wiki.gg/wiki/Copy?section=1), corroborated by a [Bob-specific community discussion](https://us.forums.blizzard.com/en/hearthstone/t/using-malorne-while-not-imbuing/146111). The community discussion is supporting evidence, not an official rules ruling.

- Freeze the Shop: Freeze all enemy minions.
- Recruit a Minion: Put a copy of an enemy minion into your hand. Your opponent gets 3 Coins.
- Refresh the Tavern: Discover a 3-Cost minion. Refresh 3 Mana Crystals.
- Find a Triple: Draw a minion. Get 2 copies of it.

Sources: [original Bob and options announcement](https://hearthstone.blizzard.com/en-us/news/24163459), [Recruit copy change](https://hearthstone.blizzard.com/en-us/news/24185348/into-the-emerald-dream-community-events-and-balance-patch-preview).

## Dream tokens

| Card                      | Mana | Stats | Rules text                                                       |
| ------------------------- | ---: | ----- | ---------------------------------------------------------------- |
| Dream                     |    0 | Spell | Return a minion to its owner's hand.                             |
| Nightmare                 |    0 | Spell | Give a minion +5/+5. At the start of your next turn, destroy it. |
| Laughing Sister           |    2 | 3/5   | Elusive.                                                         |
| Emerald Drake             |    4 | 7/6   |                                                                  |
| Ysera Awakens             |    2 | Spell | Deal 5 damage to all characters except Ysera.                    |
| Corrupted Dream           |    0 | Spell | Shuffle a minion into its owner's deck.                          |
| Corrupted Nightmare       |    0 | Spell | Give a minion Immune this turn and +5/+5.                        |
| Corrupted Laughing Sister |    2 | 6/10  | Elusive. Your hero is Elusive.                                   |
| Corrupted Drake           |    4 | 14/12 |                                                                  |
| Corrupted Awakening       |    2 | Spell | Deal 5 damage to all enemies. (ESPECIALLY Ysera!)                |

Sources: [Shaladrassil](https://hearthstone.wiki.gg/wiki/Shaladrassil), [Dream](https://hearthstone.wiki.gg/wiki/Dream), [Nightmare](https://hearthstone.wiki.gg/wiki/Nightmare), [Laughing Sister](https://www.hearthpwn.com/cards/116-laughing-sister), [Ysera Awakens](https://hearthstone.wiki.gg/wiki/Ysera_Awakens), [Corrupted Dream](https://hearthstone.wiki.gg/wiki/Corrupted_Dream), [Corrupted Nightmare](https://outof.games/realms/hearthstone/cards/32336-corrupted-nightmare), [Corrupted Laughing Sister](https://www.hearthstudy.com/card/EDR_846t3), [corrupted token reveal](https://us.forums.blizzard.com/en/hearthstone/t/new-neutral-spell-card-shaladrassil/142275), [Emerald Drake](https://liquipedia.net/hearthstone/Emerald_Drake), [Corrupted Drake](https://hearthcard.io/cards/115094-corrupted-drake).

## Resolution details and evidence strength

- Catacombs offers distinct card IDs, weighted by copies in the deck. It shuffles candidate instances, skips duplicate IDs, and offers up to three; selecting an option draws that actual instance while leaving unchosen cards in place. See [Discover duplicate-option notes](https://hearthstone.fandom.com/wiki/Discover) and [the analogous deck-tutor discussion](https://us.forums.blizzard.com/en/hearthstone/t/dire-frenzy-masters-call-dont-draw-3-beasts/3193).

- Domino Effect picks a random initial direction when both neighbors exist, then continues in that same direction. It is not contingent on a kill and stops at an invalid neighbor, including a Dormant minion. See its [mechanics notes](https://hearthstone.wiki.gg/wiki/Domino_Effect).
- Cursed Campaign produces fresh base-card copies, not inherited buffs or the granted Deathrattle. This is consistent with [observed stat-reset behavior](https://www.reddit.com/r/hearthstone/comments/1k46tsm/); this detail is community evidence rather than an official rule quotation.
- Shaladrassil generates each of the five cards once, in randomized order; overflow burns therefore depend on the seed. Its upgrade checks a higher-Cost card played by its holder while it is in hand. See its [mechanics and patch notes](https://hearthstone.wiki.gg/wiki/Shaladrassil).
- Corrupted Nightmare's +5/+5 is permanent; only Immune expires at end of turn. Corrupted Awakening destroys Ysera minions on either side before its enemy-only damage. The current catalog has only classic_ysera as a Ysera minion.
- Fyrakk targets enemies preferentially, falls back to legal friendly targets when needed, allows untargeted spells, and counts spells that fail toward its budget. See [Fyrakk mechanics](https://hearthstone.wiki.gg/wiki/Fyrakk_the_Blazing).
- Budget interpretation: sampling only spells whose base Cost fits the remaining budget is inferred from the analogous [Rune of the Archmage behavior](https://www.reddit.com/r/hearthstone/comments/1o832kz/), not independently verified against Fyrakk. The implementation uses a 100-cast safety cap because the authored Fire pool includes zero-cost Soulfire and Forbidden Flame, and stops if no positive-cost spell fits the remaining budget. Hero death ends the sequence; Fyrakk's own death does not. These are explicit runtime contracts, not additional printed card text.
- Agamaggan directly spends opponent Health: Armor, damage immunity, and damage triggers do not absorb or observe that loss. Lethal payment is allowed; cards costing more than 10 cannot be paid this way. If payment defeats the opponent, resolution ends before summon, on-play triggers, spell effects, Battlecry, or deferred choices; the played card and one-use modifier are consumed and play history is retained. See [Agamaggan mechanics](https://hearthstone.wiki.gg/wiki/Agamaggan).

## Validation checklist

- All 30 fixture cards exist, are deck legal for Warlock, and obey rarity copy limits.
- Verify Dormant timing, board-slot occupation, targeting, silence, transformation and Campaign/Cube copies. Cube’s Deathrattle summons for its current controller, including after a control change; the stored victim’s controller does not determine ownership of the summoned copies.
- Verify Dorian draw-only behavior, 1/1 and cost persistence, full-hand burns, and copying the original drawn card. Dorian must be active on the battlefield: drawing Dorian itself while none is in play must not generate a copy. Its new board-only trigger scope does not change legacy draw-trigger cards.
- Verify Bob choices, nested Discover continuation, failed draws, and enemy Coins.
- Verify Shaladrassil per-instance upgrade timing, all ten tokens, seed-stable generation order and overflow.
- Verify Agamaggan payment consumption and persistence, 10-cost cap, zero-cost cards, Armor, immunity and lethal.
- Verify Fyrakk budget, enemy preference, legal friendly fallback, no immunity, and sequential generated-spell resolution.
- Run integration tests before evaluating deck strength; keep any balancing proposals separate from correctness fixes.

## Piloting notes from the test games

- Ancient first provides six Armor and two draws across its initial Dormant period. Once it wakes, Campaign followed by Dark Pact creates two fresh engines and heals immediately. Copies created during your main phase can trigger at that turn's end; copies created during an end-turn death miss the already-captured end-turn triggers.
- Keep enough hand space for Ancient draws and Dorian copies. A full hand can burn the drawn minion or its 1/1 copy. More Ancient copies are not automatically better: four copies can congest both hand and battlefield.
- The quick line is Dorian on the battlefield, Catacombs drawing Agamaggan, 1-mana Agamaggan, full-size Agamaggan using enemy Health, then Fyrakk using enemy Health. Reserve four battlefield slots for these bodies, including Dorian. Any intervening card consumes the next-card payment effect, even a zero-cost card.
- If Agamaggan arrives before Dorian, use the survival/board plan rather than forcing the tutor line. Hard-casting Agamaggan later still gives a flexible Health-paid follow-up. If the payment itself defeats the opponent, the game ends before Fyrakk's spells.
- Maiev and Cube are defensive options as well as engine tools. Test games used Maiev to suppress an enemy threat and Cube/Dark Pact for emergency healing while preserving copied bodies.
- Shallow Grave can create four copies from Campaign or Cube, but often has no useful early target. Assess its second copy against hand congestion and the need for cheap interaction; do not spend it merely to maximize the number of engines.

Shaladrassil provides a recovery route for an early Agamaggan draw: play Agamaggan while holding it to upgrade the Dream set, spend enemy Health on Shaladrassil, then use Corrupted Dream to return Agamaggan to the deck. A surviving Dorian and later Catacombs can rebuild the cheap/full-size chain. Corrupted Awakening can prepare lethal, while the other Dreams offer removal, protection, or threats. This is a multi-turn option with survival, hand-space, and draw-order requirements, not a guaranteed rescue.
