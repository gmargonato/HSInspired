# Opponent construction simulations

Generator version 2; fixed consecutive seeds selected before inspecting outputs. These are local deck-generation simulations and static card/package reviews, not played matches or win-rate measurements. Card legality and behavior use this repository?s current catalog.

All three completed on their first assembly attempt with no fallback. Each passed 30-card legality, copy limits, strategy bounds, core retention, and support requirements. Log persistence was checked in both ai.json and match.txt. An additional audit generated 100 decks per selectable hero and verified legality, dependencies, deterministic replay, and reconstruction from the 30 logged selections.

Review exposed and corrected opponent-spell triggers, enemy cost taxes, and restricted-cost spell support before rerunning these same seeds.

## 1. Gul'dan ? The Curator

Seed: 20260915. Direction: `deck:tribe:Beast`.

Target met: all three Curator draw categories are supported (10 Beasts, 3 Dragons, 3 Murlocs). The board and refill plan is coherent. Quality is moderate: Beast support exceeds what this core needs, some bodies are low-impact, and two 9-cost cards can clog the opening hand. Four interaction cards only meet the floor. Curator targets can still be drawn before the core.

Metrics (roles overlap): earlyTwo 10; earlyThree 12; board 27; middle 10; late 6; expensive 2; interaction 4; resource 6; threat 11; dependent 1; narrow 0; weapons 0; classCards 8.

| Copies | Card                      | Mana |
| ------ | ------------------------- | ---- |
| 1      | Flame Imp                 | 1    |
| 1      | Possessed Villager        | 1    |
| 1      | Voidwalker                | 1    |
| 1      | Bloodfen Raptor           | 2    |
| 1      | Boneguard Lieutenant      | 2    |
| 1      | Darkbomb                  | 2    |
| 2      | Haunted Creeper           | 2    |
| 2      | Murloc Tidehunter         | 2    |
| 1      | Puddlestomper             | 2    |
| 1      | Hired Gun                 | 3    |
| 1      | Shadow Bolt               | 3    |
| 1      | Squirming Tentacle        | 3    |
| 1      | Lost Tallstrider          | 4    |
| 1      | Oasis Snapjaw             | 4    |
| 1      | Tomb Spider               | 4    |
| 2      | Azure Drake               | 5    |
| 2      | Kara Kazham!              | 5    |
| 1      | Silver Hand Knight        | 5    |
| 2      | Stranglethorn Tiger       | 5    |
| 1      | Mukla, Tyrant of the Vale | 6    |
| 1      | Siphon Soul               | 6    |
| 1      | Dr. Boom                  | 7    |
| 1      | The Curator               | 7    |
| 1      | North Sea Kraken          | 9    |
| 1      | Ysera                     | 9    |

## 2. Anduin Wrynn ? Loatheb

Seed: 20260916. Direction: `standalone`.

Target met: the intentionally standalone branch builds independent board pressure around Loatheb. Azure Drakes and generated resources support continued development. Quality is moderate: many 5-cost plays compete for the same turn, Goldshire Footman is a weak late draw, and this is a general midrange deck rather than a tightly coupled synergy package.

Metrics (roles overlap): earlyTwo 9; earlyThree 10; board 26; middle 12; late 4; expensive 1; interaction 6; resource 5; threat 13; dependent 0; narrow 2; weapons 0; classCards 6.

| Copies | Card                 | Mana |
| ------ | -------------------- | ---- |
| 2      | Argent Squire        | 1    |
| 1      | Clockwork Gnome      | 1    |
| 1      | Goldshire Footman    | 1    |
| 2      | Holy Smite           | 1    |
| 2      | Mistress of Mixtures | 1    |
| 2      | Huge Toad            | 2    |
| 1      | Puddlestomper        | 2    |
| 1      | Shadow Word: Pain    | 2    |
| 1      | Shadow Word: Death   | 3    |
| 1      | Spider Tank          | 3    |
| 1      | Chillwind Yeti       | 4    |
| 2      | Silvermoon Guardian  | 4    |
| 2      | Azure Drake          | 5    |
| 2      | Kabal Songstealer    | 5    |
| 1      | Loatheb              | 5    |
| 2      | Pit Fighter          | 5    |
| 1      | Sludge Belcher       | 5    |
| 1      | Stranglethorn Tiger  | 5    |
| 1      | Sunwalker            | 6    |
| 1      | Toshley              | 6    |
| 1      | Dr. Boom             | 7    |
| 1      | Nefarian             | 9    |

## 3. Valeera Sanguinar ? Arcane Anomaly

Seed: 20260917. Direction: `spells`.

Target met: two Arcane Anomalies and Violet Teacher have nine cheap spells to trigger them. Removal and draw overlap usefully with support. Quality is moderate to good in coherence: the payoff package is real, but the early-board and interaction counts only meet the floors, and two 9-cost cards slow an otherwise tempo-oriented deck.

Metrics (roles overlap): earlyTwo 6; earlyThree 8; board 21; middle 9; late 4; expensive 2; interaction 4; resource 9; threat 8; dependent 0; narrow 0; weapons 0; classCards 10.

| Copies | Card               | Mana |
| ------ | ------------------ | ---- |
| 1      | Backstab           | 0    |
| 2      | Arcane Anomaly     | 1    |
| 1      | Journey Below      | 1    |
| 1      | Lowly Squire       | 1    |
| 1      | Pit Snake          | 1    |
| 2      | Faerie Dragon      | 2    |
| 2      | Shiv               | 2    |
| 1      | Burgle             | 3    |
| 2      | Fan of Knives      | 3    |
| 2      | Shadow Strike      | 3    |
| 1      | Spider Tank        | 3    |
| 1      | Violet Illusionist | 3    |
| 1      | Evil Heckler       | 4    |
| 1      | Lost Tallstrider   | 4    |
| 1      | Polluted Hoarder   | 4    |
| 1      | Violet Teacher     | 4    |
| 1      | Azure Drake        | 5    |
| 1      | Pit Fighter        | 5    |
| 1      | Psych-o-Tron       | 5    |
| 1      | Sludge Belcher     | 5    |
| 1      | Spectral Knight    | 5    |
| 1      | Piloted Sky Golem  | 6    |
| 1      | Sunwalker          | 6    |
| 1      | North Sea Kraken   | 9    |
| 1      | Ysera              | 9    |

## Assessment

The layered assembly meets its structural target and preserves variety. Passing constraints does not establish competitive strength. Remaining tuning opportunities are support saturation, stronger filler ratings, and finer mana-curve distribution. Specialized mechanics outside the assessment allowlist remain excluded; this pass does not add C?Thun, Yogg, or N?Zoth packages. Aggro/control remain disabled.
