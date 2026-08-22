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

Once both mulligans resolve, the match enters its `turns` phase and tracks a `turnNumber`.
Only the active player may dispatch `end-turn`, which hands play to the other player, increments
the turn counter, and draws one card for the new active player (emitting `turn-started` and
`card-drawn`). Draws stop when a deck is empty; when a hand already holds the `MAX_HAND_SIZE`
(10) cards, the drawn card is removed from the deck and burned (`card-burned`) per the
Hearthstone rule. Non-active players and mulligan-phase `end-turn` commands are rejected with
no mutation.

Each player also carries `mana` (`available`/`maximum`) and a `heroPower`
record (`cost`, seeded from the class definition's catalog, plus `available`).
At the start of every turn the starting player's crystal maximum grows by one
up to `MAX_MANA` (10) and available mana refills to the new maximum. Both
`opening-turn-started` and `turn-started` events carry the new value, and each
turn start refreshes the new active player's hero power.

The active player may dispatch `use-hero-power` once per own turn: it spends
`heroPower.cost` mana from the available pool, exhausts the power until the
owner's next turn start, and emits `hero-power-used` with the cost and
remaining mana. Non-active players, already-used powers, and unaffordable uses
are rejected with no mutation. The power's in-game effect arrives with future
gameplay; cost-altering effects are also future work, and the renderer already
tints the cost label red/green for such a case.

Deck-selection adapters use `createHumanVsAiMatchSetup` (or the renderer's
`createHumanVsAiGameRoute`) to create the typed future `GameScene` route. No match inputs are
discovered through renderer globals.

`runMatchArchitectureProof` remains intentionally thin for the original boundary proof. The
current boundary covers the opening hands, mulligan, an alternating turn/draw loop, mana
crystal growth, and hero power mana spending; combat, card resolution, triggers, an action
stack, networking, account state, and AI strategy remain future work.
