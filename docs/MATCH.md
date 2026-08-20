# Match boundary

`src/game/match` is a platform-neutral proof of the future engine boundary. A `MatchSetup`
contains exactly two `MatchParticipantSetup` values, each with a `PlayerId`, controller kind,
hero ID, and deck reference. `ControllerKind` is `human | ai`; both use the same command API.
An optional numeric seed defines deterministic proof randomness.

`createMatch` validates setup input, exposes cloned serializable state, accepts unknown command
values at the boundary, and returns either an accepted result or an explicit rejection. A
minimal `ready` command can emit an ordered sequence of multiple events. Invalid commands return
no events and do not mutate state. `createSeededRng` is injected at the match boundary so rule
code does not use ambient randomness.

Deck-selection adapters use `createHumanVsAiMatchSetup` (or the renderer's
`createHumanVsAiGameRoute`) to create the typed future `GameScene` route. No match inputs are
discovered through renderer globals.

`runMatchArchitectureProof` is intentionally thin. It proves serialization, event sequencing,
rejection, and determinism without introducing turns, mana, zones, combat, triggers, an action
stack, networking, account state, or AI strategy.
