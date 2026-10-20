# Expert decision fixes from the Yore sweep

This change is separate from the Yore card/engine implementation (PR #21). It
changes only AI decision support and its regression tests; card rules and the
frozen 30-card deck remain unchanged.

## Reproduced failures and fixes

- **Enemy healing:** spell healing was not recognized by the event check used
  for hero-power healing. Compare observed Health changes instead, while retaining
  the existing payoff/trigger safeguards. Forbidden Healing no longer gets a free
  pass merely because it emits a different event.
- **Enemy Attack buffs:** apply a soft penalty to an otherwise unpaid pure Attack
  gift. Known Attack-threshold removal and combat/death-trigger setup remain search
  decisions. This is not a blanket ban on buffing enemy minions.
- **Self-targeted mixed damage:** extend the existing soft self-damage advice to
  simple damage plus target-independent random summon spells. Known health,
  damage, spell and summon payoffs remain exemptions. Random outcomes are not
  treated as deterministic tactical proofs.
- **Unused Armor damage:** extend the bounded unused-attack inspector to ready
  minion attacks wholly absorbed by Armor, only when the observed position is
  otherwise unchanged. It does not force attacks across Health thresholds.
- **Public lethal defense:** the old support boundary excluded Dormant minions,
  Campaign's sleeping copies and Dorian's hand-only draw copy, so no public attack
  defense was considered in those positions. Add narrowly supported mechanics and
  a bounded two-action defense when no one-action defense was certified. Preserve
  the original 512-dispatch / 750 ms limit. A certificate belongs only to its exact
  complete line, including End Turn.

## Checkpoint validation

Five completed-match positions were replayed through the production Expert
worker/API path, with three fair search worlds per decision and no fallback:

| Archived position | Previous decision                   | New observed decision                                                     |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Waygate Giants    | Pass despite free Sap               | Frost Nova; another world selected Sap                                    |
| Flamewaker Mage   | Firelands Portal into own hero      | Ping an Ancient, with Flamestrike then pass in the selected searched line |
| Anyfin Paladin    | Forbidden Healing on opponent       | Retain the card and pass                                                  |
| Jade Rogue        | Cold Blood on enemy Ancient         | Cold Blood on friendly Dark Iron Skulker                                  |
| Dragon Priest     | Skip ready Twilight Guardian attack | Attack the opponent's Armor                                               |

The public proof for Waygate uses 51 dispatches and for the Mage clear-plus-ping
uses 86, both below the unchanged cap. These are isolated decisions, not replayed
match wins or evidence of a measured overall win-rate increase.

## Deliberate limits

- Safety certificates cover public attacks, not unknown hand plays or future
  draws. Unsupported conditions, secrets and stochastic effects still abstain.
- Concealed cards are inert spell placeholders in the attack-only model. Under
  the closed support boundary, suppressing hand-only minion-draw copies cannot
  change available attacks. This is not a prediction of the opponent's draw.
- Newly awakened minions are handled by the engine before attack enumeration.
  Fresh copies born during the reply remain Dormant; unsupported restored printed
  effects are rejected even if their source was silenced.
- Free Health damage, the Jungle Giants development pass, Finja sequencing and
  Leeroy's trade remain qualified leads rather than forced heuristics. The Crystal
  Caverns Vanish had a concrete defensive benefit and was not treated as a defect.
- The original sweep remains 26 wins / 7 losses. No historical outcomes were
  replaced by these checkpoint checks.

## Verification

- Full suite: **3,429 passed, 25 failed, 1 skipped**. All 25 failure names match
  the engine PR baseline exactly; there are no new failures and 28 added tests pass.
- Focused final safety/tactical suite: **85 passed**.
- Typecheck, dependency boundaries, production build, changed-file ESLint and
  Prettier checks pass. No GUI verification is claimed.
- This is not an all-green repository baseline. Existing failures, unrelated
  full-repository lint/format issues and missing card art are not changed here.
