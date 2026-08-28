# Renderer-side rules migration map

The renderer may request and present domain results, but it must not authoritatively decide
the following rules. Each item is assigned to the roadmap phase where the domain contract
becomes authoritative.

| Current renderer decision                                  | Migration owner               |
| ---------------------------------------------------------- | ----------------------------- |
| Whether a hand card is playable from local mana/turn state | Phase 2 legality query        |
| Whether a card needs a target, choice, or board position   | Phase 2 play-input query      |
| Which target is legal, including Taunt/Stealth/immunity    | Phases 2 and 10               |
| Opponent card selection and play legality                  | Phase 2 controller parity     |
| Combat attacker/defender legality and damage math          | Phases 8 and 10               |
| Trigger ordering, death resolution, and match end          | Phases 3, 8, and 11           |
| Effect target selection, values, repeats, and random pools | Phase 4 resolver queries      |
| Cost/stat/keyword display values                           | Phases 7 and 12 derived state |
| Secret matching, replacement, and hidden identity          | Phase 13 interrupt runtime    |
| Timeout result and turn-limit authority                    | Phase 14 domain command       |

Existing Pixi code remains presentation and input plumbing until each owner phase removes
the corresponding local decision.
