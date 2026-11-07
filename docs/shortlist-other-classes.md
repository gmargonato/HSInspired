# Priest, Warrior, Shaman and Warlock shortlist scenarios

The twelve entries in `shortlist-priest-warrior-shaman-warlock.json` use the selected printed versions: Possessed Lackey costs 5; Granite Forgeborn costs 4 and is 4/5; Lord Godfrey is Undead. Wailing Vapor belongs to Forged in the Barrens (Wailing Caverns mini-set). No artwork is changed.

Existing `goblins_vs_gnomes_boom_bot` is the exact 1-mana 1/1 Mech with random-enemy 1–4 damage Deathrattle. Existing `basic_voidwalker` is the exact 1-mana 1/3 Demon with Taunt. No duplicate tokens are needed.

## Durable executable scenarios

Run `npx vitest run src/game-rules/match/effects/shortlist-other-classes.scenarios.ts`.

| Card                 | Scenarios                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duskbreaker          | No other Dragon in hand means no damage; another held Dragon enables 3 damage to both boards; source excluded.                                                                                                                   |
| The Light! It Burns! | Current Attack, including a buff; friendly and enemy minions; zero Attack; Divine Shield; Spell Damage.                                                                                                                          |
| Risky Skipper        | Does not trigger on itself or summons; another friendly minion played damages both boards, including Skipper and the played minion.                                                                                              |
| Bomb Wrangler        | Nonlethal and lethal damage both summon a Boom Bot; a full board blocks the summon before the lethally wounded source is removed.                                                                                                |
| Wailing Vapor        | Other friendly Elementals played grant Attack; itself, summons and non-Elementals do not.                                                                                                                                        |
| Granite Forgeborn    | Existing hand and deck Elementals receive permanent reductions; non-Elementals and cards generated later do not; discounted deck cards retain reduction when drawn; stacking floors cost at zero.                                |
| Canal Slogger        | Rush allows immediate minion combat but not hero combat; one mana overloaded next turn; Lifesteal includes overkill, caps at maximum hero health, works when the attacker dies and does not heal from Divine Shield or immunity. |
| Kobold Librarian     | Draw and self-damage; empty deck causes fatigue plus the separate 2 damage.                                                                                                                                                      |
| Possessed Lackey     | One Demon recruited from deck, suppressing its Battlecry; no eligible Demon is a no-op; its own death frees a slot on a full board.                                                                                              |
| Voidlord             | Three exact Voidwalkers; limited by board capacity; simultaneous Voidlord deaths resolve and summon without destroying newly created tokens.                                                                                     |
| Skull of the Man'ari | Own start-of-turn summon from hand; no Battlecry; no durability loss; empty eligible pool and full board leave hand cards intact.                                                                                                |
| Lord Godfrey         | Source excluded; no repeat without a death; deaths and Deathrattle summons resolve between successive 2-damage waves.                                                                                                            |

The suite uses real catalog cards, seeded public match commands, and a checkpoint only to construct the immune-target fixture. It contains no production-only shortcuts or temporary test loaders.

## Necessary engine correction

`applyDamageNow` previously used capped health loss as Lifesteal's healing amount. A 6-Attack Canal Slogger hitting a 5-health minion therefore healed only 5. Lifesteal includes overkill damage. A separate minion-target Lifesteal amount now preserves the full unprevented hit while respecting minimum-health prevention. Shield, immunity and zero-damage exits remain unchanged; actual health loss, trace fields, history and damage events remain unchanged.

Three existing spell Lifesteal assertions were intentionally corrected, rather than changing card stats or damage accounting:

- Spell Damage Spirit Lash hitting two 1-health minions and one larger minion heals 6, not 4.
- Velen's Drain Soul hitting a Wisp heals 12, not 2, while recorded health loss remains 1.
- Velen at 1 health still doubles both Spirit Lash heals before the death checkpoint: 4 + 4, not 2 + 4.

Run both this suite and `src/game-rules/match/effects/three-sets.integration.test.ts` for the related regression coverage.
