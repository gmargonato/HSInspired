# Card audit corrections

Baseline: Basic/Classic at the March 11, 2014 launch; subsequent sets at their original expansion release. This is a restoration of the confirmed audit findings and identified later balance changes, not a claim that every interaction in the catalog has been exhaustively tested.

## Evidence

- [Launch card data, build 4944](https://api.hearthstonejson.com/v1/4944/enUS/cards.json) and [official launch patch notes](https://hearthstone.blizzard.com/en-us/news/13154924) establish core values and the launch versions of Nat Pagle and Tinkmaster.
- [Archived 2015 card data, build 10956](https://api.hearthstonejson.com/v1/10956/enUS/cards.json) supplies the original Grand Tournament values. It was not treated as a blanket release baseline for older cards that were nerfed before that snapshot.
- [Official May 2014 patch](https://hearthstone.blizzard.com/en-gb/news/14070049/hearthstone-patch-notes-1005314-5-8-2014) confirms Unleash the Hounds originally cost 2 at launch, before increasing to 3.
- [Official 27.2 changes](https://hearthstone.blizzard.com/en-gb/news/23987537/27-2-patch-notes/) document many later buffs being reverted here.
- [Anub'arak history](https://hearthstone.wiki.gg/wiki/Anub%27arak), [Knight of the Wild](https://hearthstone.wiki.gg/wiki/Knight_of_the_Wild), [Joust rules](https://hearthstone.wiki.gg/wiki/Joust), and [Spell Damage rules](https://hearthstone.wiki.gg/wiki/Spell_Damage) support the relevant behavior corrections.

## Changed

58 authored JSON records changed, plus Malygos runtime support and the generated Nerubian definition. Card descriptions and executable effects were updated together where behavior changed.

| Card                       | Correction                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Healing Touch              | Healing can target either side.                                                                                                     |
| Holy Light                 | Healing can target either side.                                                                                                     |
| Hunter's Mark              | cost: 1 ? 0 Effect targeting corrected.                                                                                             |
| Soulfire                   | cost: 1 ? 0 Effect targeting corrected.                                                                                             |
| Voodoo Doctor              | Battlecry healing can target either side.                                                                                           |
| Dragon's Breath            | Damage can target either side.                                                                                                      |
| Revenge                    | One conditional 1/3 damage pulse, rather than 1 plus 2; Spell Damage applies once.                                                  |
| Blackwing Corruptor        | Battlecry damage can target either side.                                                                                            |
| Ancient of Lore            | Healing choice can target either side.                                                                                              |
| Ancient Secrets            | Healing option target matches its parent.                                                                                           |
| Commanding Shout           | Draws a card; turn protection applies to current and later friendly minions.                                                        |
| Earthen Ring Farseer       | Battlecry healing can target either side.                                                                                           |
| Gadgetzan Auctioneer       | cost: 6 ? 5 Effect targeting corrected.                                                                                             |
| Gnoll                      | cost: 1 ? 2 attack: 1 ? 2 health: 1 ? 2 Taunt.                                                                                      |
| Lay on Hands               | Healing can target either side.                                                                                                     |
| Millhouse Manastorm        | Enemy spells, including spells drawn during the turn, cost zero next turn; effect expires afterward.                                |
| Nat Pagle                  | At the start of your turn, you have a 50% chance to draw an extra card.                                                             |
| Starfall                   | rarity: Common ? Rare Effect targeting corrected.                                                                                   |
| Tinkmaster Overspark       | attack: 2 ? 3 health: 2 ? 3 Battlecry: Transform another random minion into a 5/5 Devilsaur or a 1/1 Squirrel.                      |
| Tundra Rhino               | Your Beasts have Charge.                                                                                                            |
| Unleash the Hounds         | cost: 3 ? 2 Effect targeting corrected.                                                                                             |
| Siltfin Spiritwalker       | Whenever another friendly Murloc dies, draw a card. Overload: (1)                                                                   |
| Burrowing Mine             | Authored on-draw effect deals 10 damage.                                                                                            |
| Astral Communion           | cost: 5 ? 4 Effect targeting corrected.                                                                                             |
| Knight of the Wild         | Cost reductions accumulate only for Beasts summoned while this card is in hand.                                                     |
| Lock and Load              | cost: 0 ? 2 Effect targeting corrected.                                                                                             |
| Ball of Spiders            | cost: 3 ? 6 Effect targeting corrected.                                                                                             |
| Acidmaw                    | cost: 3 ? 7 Whenever another minion takes damage, destroy it.                                                                       |
| Dreadscale                 | At the end of your turn, deal 1 damage to all other minions.                                                                        |
| Spellslinger               | Battlecry: Add a random spell to each player's hand.                                                                                |
| Dalaran Aspirant           | Inspire: Gain Spell Damage +1.                                                                                                      |
| Flame Lance                | Deal 8 damage to a minion.                                                                                                          |
| Coldarra Drake             | health: 7 ? 6 Effect targeting corrected.                                                                                           |
| Warhorse Trainer           | attack: 3 ? 2 Your Silver Hand Recruits have +1 Attack.                                                                             |
| Enter the Coliseum         | cost: 3 ? 6 Effect targeting corrected.                                                                                             |
| Holy Champion              | cost: 2 ? 4 attack: 1 ? 3 health: 4 ? 5 Whenever a character is healed, gain +2 Attack.                                             |
| Shadowfiend                | cost: 2 ? 3 attack: 2 ? 3 Effect targeting corrected.                                                                               |
| Convert                    | cost: 3 ? 2 Put a copy of an enemy minion into your hand.                                                                           |
| Spawn of Shadows           | cost: 5 ? 4 health: 5 ? 4 Inspire: Deal 4 damage to each hero.                                                                      |
| Confessor Paletress        | Inspire: Summon a random Legendary minion.                                                                                          |
| Poisoned Blade             | cost: 2 ? 4 Effect targeting corrected.                                                                                             |
| Burgle                     | Add 2 random class cards to your hand (from your opponent's class).                                                                 |
| Shado-Pan Rider            | Combo: Gain +3 Attack.                                                                                                              |
| Anub'arak                  | cost: 8 ? 9 Returns from death to hand and summons a plain 4/4 Nerubian.                                                            |
| Tuskarr Totemic            | cost: 2 ? 3 Battlecry: Summon ANY random Totem.                                                                                     |
| Ancestral Knowledge        | Draw 2 cards. Overload: (2)                                                                                                         |
| Healing Wave               | Targets any character; a single 7/14 heal based on joust. An opposing deck without minions loses to a revealed minion.              |
| Charged Hammer             | cost: 3 ? 4 Effect targeting corrected.                                                                                             |
| Elemental Destruction      | Deal 4-5 damage to all minions. Overload: (5)                                                                                       |
| Draenei Totemcarver        | health: 5 ? 4 Effect targeting corrected.                                                                                           |
| Thunder Bluff Valiant      | Inspire: Give your Totems +2 Attack.                                                                                                |
| Tiny Knight of Evil        | Whenever you discard a card, gain +1/+1.                                                                                            |
| Demonfuse                  | Give a Demon +3/+3. Give your opponent a Mana Crystal.                                                                              |
| Dreadsteed                 | Deathrattle: Summon a Dreadsteed.                                                                                                   |
| Dark Bargain               | cost: 4 ? 6 Effect targeting corrected.                                                                                             |
| Bash                       | cost: 2 ? 3 Effect targeting corrected.                                                                                             |
| Mukla's Champion           | attack: 5 ? 4 Effect targeting corrected.                                                                                           |
| Justicar Trueheart         | cost: 5 ? 6 health: 4 ? 3 Effect targeting corrected.                                                                               |
| Malygos                    | The validator retains the authored spellDamage value and the engine uses +5 instead of defaulting to +1. Silence removes the bonus. |
| Nerubian (Anub'arak token) | Removed the modern Deathrattle that resummoned Anub'arak; original token is a plain 4/4.                                            |

## Preserved and skipped

- **Undertaker:** untouched, including the existing +1/+1 behavior, as explicitly requested.
- **Imp-losion:** its custom damage/summoning formula is untouched.
- **Lord Jaraxxus:** remains the existing Hero card with its existing cost, armor, and effects; not reverted to a minion.
- **Iron Juggernaut:** retains both Battlecry and Deathrattle. Only the generated Mine's missing damage was fixed.
- **Acidic Swamp Ooze:** the user's corrected 3 Attack was already present and remains unchanged.
- No blanket subtype/tribe retagging, wholesale rules-text replacement, or ambiguous same-name token matching was applied. For example, the archive contains both a tutorial 1/1 Gnoll and Hogger's 2/2 Taunt Gnoll; the latter is the verified intended token.
- Modern tribe tags and other differences outside the confirmed audit were not treated as authorization to guess at changes.

## Validation

All 262 focused tests passed across 18 effect/content test files. Focused effect and content tests cover the corrected runtime paths. Added regression coverage checks Malygos and silence, Millhouse timing/expiry, normal Mine draws, Revenge's single pulse, Healing Wave's loss/win/empty-opponent-deck outcomes and single heal, Anub'arak and its plain token, Knight of the Wild's in-hand timing, Hogger, and Commanding Shout's draw/protection/expiry. Existing Iron Juggernaut coverage verifies both triggers.

TypeScript, dependency boundaries, and lint were checked. The application was not launched; visual/manual play validation remains with the user. No temporary test files were added.
