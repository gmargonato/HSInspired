# Match boundary

`src/game/match` is a platform-neutral engine boundary. A `MatchSetup` contains exactly two
`MatchParticipantSetup` values, each with a `PlayerId`, controller kind, hero ID, and deck
reference. `ControllerKind` is `human | ai`; both use the same command API. An optional numeric
seed defines deterministic player assignment and deck randomness.

`createMatch` remains the small readiness/proof boundary used by architecture tests. The
opening sequence is implemented by `createOpeningMatch`, which receives deck snapshots,
expands card counts into uniquely identified instances, deals three cards to Player 1 and four
to Player 2, and exposes cloned serializable state. `confirm-mulligan` validates card-instance
selection, returns selected cards to the deck after drawing replacements, and emits ordered
events for replacement cards, the Coin, Player 1's opening turn, and the opening draw. Invalid
commands return no events and do not mutate state. `createSeededRng` is injected at the match
boundary so rule code does not use ambient randomness.

Deck-selection adapters use `createHumanVsAiMatchSetup` (or the renderer's
`createHumanVsAiGameRoute`) to create the typed future `GameScene` route. No match inputs are
discovered through renderer globals.

`runMatchArchitectureProof` remains intentionally thin for the original boundary proof. The
opening match deliberately stops after Player 1's first draw; mana, combat, card resolution,
triggers, an action stack, networking, account state, and AI strategy remain future work.
