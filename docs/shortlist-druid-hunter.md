# Shortlisted Druid and Hunter cards

The selected gallery versions are implemented in `src/game-rules/content/cards/sets/shortlist-druid-hunter.json`: 13 collectible cards and eight noncollectible, non-deck-legal tokens. Every record belongs to Future Past. Original expansion prefixes remain in stable card IDs for deck and artwork compatibility. Existing card balance is unchanged; artwork imports are documented in the implementation summary.

## Version decisions

- Splish-Splash Whelp is the selected two-mana 2/1 version.
- Awakening Tremors gives three one-mana **4/1** Worms.
- Scavenger's Ingenuity gives the drawn Beast **+3/+3**.
- Adorable Infestation and its Marsuul Cub carry both Druid and Hunter membership.
- Breath of Dreams is Nature. No school was invented for selected renders without a school label.
- Dreamway Guardians' token is named **Crystal Dryad**, and Adorable Infestation's token is **Marsuul Cub**. The parent spells use the shorter printed descriptions.
- Other tokens: Squirrel, Glowfly, Disarmed Zombie, Zombie, Lynx and Worm. Dragon Golem copies the source minion, including permanent buffs, rather than generating a separate token definition.

The selected reference images were transcribed in the implementation's supplied `selected_specs.json`; their gallery provenance is retained in the companion implementation source manifest. Token metadata was cross-checked against the [official Crystal Dryad entry](https://hearthstone.blizzard.com/en-us/cards/52839-crystal-dryad), [Marsuul Cub entry](https://www.hearthpwn.com/cards/330110), [Glowfly entry](https://hearthstone.wiki.gg/wiki/Glowfly), and [Squirrel entry](https://hearthstone.wiki.gg/wiki/Squirrel_%28Acornbearer%29). The selected [Awakening Tremors version](https://outof.games/realms/hearthstone/cards/28507-awakening-tremors) explicitly supplies the one-mana 4/1 Worms.

## Executable scenario plan

Run `npx vitest run src/game-rules/match/effects/shortlist-druid-hunter.scenarios.ts`. The durable `.scenarios.ts` filename complies with AGENTS.md's instruction to remove newly created `.test` files and is included in normal Vitest discovery.

| Card                  | Assertions                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acornbearer           | Combat death adds two Squirrels; hands of zero, eight, nine and ten respect the ten-card limit.                                                                                                                             |
| Dreamway Guardians    | Two 1/2 Lifesteal Dryads, one free board slot and full-board cases; combat damage heals the controller.                                                                                                                     |
| Glowfly Swarm         | Zero, three and nine remaining spells; six/seven occupied board slots; excludes the cast spell and non-spells from its count.                                                                                               |
| Lingering Zombie      | Three successive deaths produce Disarmed Zombie, then Zombie, then nothing; replacement works on a seven-minion board.                                                                                                      |
| Breath of Dreams      | Draw precedes the Dragon check; newly drawn Dragon qualifies, non-Dragon does not; already held Dragon qualifies; empty ramp preserves available mana and caps at ten; empty deck fatigues but does not skip the condition. |
| Splish-Splash Whelp   | The played Whelp does not count itself; another Dragon enables empty ramp; ten-crystal cap.                                                                                                                                 |
| Desert Nestmatron     | The played Nestmatron does not count itself; another Dragon restores four spent mana; maximum remains unchanged; Taunt.                                                                                                     |
| Emerald Explorer      | Taunt; three distinct Dragon choices; chosen card reaches hand.                                                                                                                                                             |
| Dragon Golem          | Zero/one/three held Dragons; six/seven-slot board limit; Taunt; copied permanent hand buffs; continuous aura is not double-counted.                                                                                         |
| Springpaw             | Generates Lynx; both immediately attack minions but cannot attack heroes with Rush; playing from a full hand leaves exactly one slot for Lynx.                                                                              |
| Adorable Infestation  | Friendly/enemy target gets +1/+1; a Cub appears on board and in hand; full board still allows buff and hand generation; no legal minion target rejects the cast without spending mana.                                      |
| Awakening Tremors     | Three selected one-mana 4/1 Worms; partial generation at hand capacity; generated Worm plays with correct stats and mana cost.                                                                                              |
| Scavenger's Ingenuity | Draws Beast past a non-Beast; +3/+3 persists into play; generated Lynx is not accidentally buffed; no Beast neither draws/fatigues nor buffs an existing hand Beast.                                                        |

The suite additionally verifies catalog registration, token collectibility/deck legality, selected numeric versions, and dual-class eligibility.

## Shared engine correction

`runSummonAction` previously clamped `summon-copy`'s evaluated count to at least one. Dragon Golem exposed this at zero Dragons. The shared correction changes the floor to zero while retaining the omitted-count default of one. The zero-Dragon scenario protects this behavior; all other effects use existing declarative primitives.

## Verification

43 deterministic scenarios passed. Focused ESLint and formatting checks passed. The new source passed the web TypeScript check; whole-repository validation is recorded in the implementation summary.
