# Selected Mage, Mech, and Rogue card scenarios

The selected renders are the numeric/text authority. This slice adds 16 collectible cards and the uncollectible Jo-E Bot, all assigned to Future Past while preserving their existing identifiers. Artwork imports are documented in the implementation summary.

Run the durable scenarios with:

```sh
npx vitest run src/game-rules/match/effects/shortlist-mage-rogue.scenarios.ts
```

The scenarios use the production catalog and real checkpoint-restored matches, dispatch normal play/attack/end-turn commands, and inspect resulting state and effect events. Seeded random-target scenarios cover multiple deterministic outcomes. Direct developer summons are used only to prove that summoning a minion does not run its Battlecry.

## Scenario matrix

| Card               | Runtime scenarios                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aluneth            | Three draws at controller end turn; no draw trigger at opposing end turn; ordinary next-turn draw remains separate; durability unchanged; full hand burns excess draws; three successive fatigue increments; replacing another Aluneth does not stack; replacing with another weapon removes trigger.                           |
| Ancient Mysteries  | Filters deck to Secret, sets only drawn Secret to zero, leaves pre-existing hand Secret unchanged; empty/no matching deck is not fatigue; Auctioneer fills hand before filtered draw and causes burn.                                                                                                                           |
| Arcane Flakmage    | Own played Secret deals two to each enemy minion, excludes heroes/friendlies; ignores opposing Secret and ordinary spell; countered Secret does not trigger; Mad Scientist putting Secret into play does not trigger; damage precedes resulting Loot Hoarder draw.                                                              |
| Cloud Prince       | Without own Secret (including enemy-only Secret), plays as plain body without target; with own Secret deals six to chosen hero.                                                                                                                                                                                                 |
| Flame Ward         | Minion attack deals combat damage first, then Ward damages attacking side including attacker; cannot prevent lethal combat; ignores hero attacks, minion-to-minion attacks, and spell damage; scales with controller Spell Damage.                                                                                              |
| Occult Conjurer    | No friendly Secret means no copy; friendly Secret creates exactly one copy and preserves hand buffs; copied minion does not replay Battlecry; full board caps copy; direct summon does not run Battlecry.                                                                                                                       |
| Click-Clocker      | Divine Shield; exactly one randomly selected hand Mech receives +1/+1; non-Mech and board Mech untouched; no matching hand Mech is harmless; direct summon does not buff.                                                                                                                                                       |
| Mecharoo           | Death summons one 1/1 Jo-E Bot; death on full board frees its slot and token respects seven-minion limit.                                                                                                                                                                                                                       |
| Galvanizer         | Discounts only hand Mechs; repeated Battlecries stack to zero, never negative; deck and non-Mechs untouched; body remains unchanged.                                                                                                                                                                                            |
| Security Automaton | Does not trigger on its own arrival; friendly played Mech triggers, non-Mech does not; deathrattle-summoned Jo-E Bot triggers; opposing Automaton does not observe friendly summons.                                                                                                                                            |
| Mecha-Shark        | No self-trigger or non-Mech trigger; each friendly Mech causes three individual one-damage hits; deathrattle summons trigger as well; random hits reselect living targets without wasting hits on mortally wounded minions; on-damage Imp summons are eligible for later hits; deathrattles process at volley death checkpoint. |
| Seafloor Gateway   | Draws exactly **one** Mech, then discounts drawn and previously held Mechs; leaves other deck cards and non-Mechs untouched; still discounts with no matching deck card and causes no fatigue.                                                                                                                                  |
| Hench-Clan Thug    | Friendly minion attacks do not trigger; own hero attack grants +1/+1; temporary hero Attack works without a weapon.                                                                                                                                                                                                             |
| Prize Plunderer    | First-card play needs no target/effect; Combo damage counts only earlier cards, excludes itself; minions summoned by Mirror Image do not inflate card-play count.                                                                                                                                                               |
| Raiding Party      | Original **three-mana** cost; two Pirates without Combo; two Pirates plus weapon with Combo; depleted matching pools do not fatigue; full-hand draws burn excess matches while leaving nonmatches.                                                                                                                              |
| Cutting Class      | Rogue/Warrior eligibility; costs 5 without weapon, 2 with 3-Attack weapon, zero with 7-Attack weapon; draws two; ignores temporary hero Attack; updates after equip and weapon destruction; ordinary empty-deck draws cause fatigue.                                                                                            |
| Jo-E Bot           | Registered as noncollectible and not deck-legal; summoned 1/1 Mech; not a recursively deathrattling Mecharoo.                                                                                                                                                                                                                   |

## Preserved selected details

- Click-Clocker, Mecharoo, and Mecha-Shark carry both Mech and Beast tribes.
- Hench-Clan Thug is Neutral and a Quilboar.
- Cutting Class belongs to both Rogue and Warrior, and its discount reads weapon Attack rather than total hero Attack.
- Hand-only Mech discounts use hand-zone selectors and a zero floor.
- Flame Ward uses the post-combat attack event, requires an opposing minion attacker and a surviving defending hero.
- Arcane Flakmage observes a successfully played-from-hand Secret, after the Secret enters play; countered spells and put-into-play effects do not qualify.
- Missile damage resolves individual reactions and excludes mortally wounded targets between hits. Deathrattles resolve at the volley's death checkpoint, consistent with the engine's established missile rules.
- All effects use existing declarative runtime primitives. No card-name special cases or engine edits are required.

## Missile timing reference

The [Hearthstone advanced rulebook](https://hearthstone.wiki.gg/wiki/Advanced_rulebook) distinguishes damage reactions from death processing. During a missile volley, an on-damage reaction such as Imp Gang Boss can summon a new eligible target before the next hit. A mortally wounded minion is excluded from further random hits, but its Deathrattle is deferred to the outer death checkpoint after the volley. Separate scenarios assert both the immediate Imp interaction and delayed Mecharoo/Jo-E Bot interaction.
