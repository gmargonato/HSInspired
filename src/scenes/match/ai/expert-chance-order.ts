import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import {
  canonicalCommandKey,
  enumerateLegalCommands
} from '../../../game-rules/match/ai/legal-commands'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatch } from '../../../game-rules/match/opening-match'
import {
  createSeededRng,
  type RandomTargetSelection
} from '../../../game-rules/match/rng'
import type {
  OpeningMatchCheckpoint,
  OpeningMatchAnalysis,
  OpeningMatchEvent,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'
import { moreFaceDamageWithSameResources } from './expert-committed-order'
import { CARD_CATALOG } from '../../../game-rules/content/cards'

export const EXPERT_CHANCE_ORDER_MAX_MS = 100

/** A cheap public-metadata candidate filter; the engine proof remains authoritative. */
export function hasChanceWeaponSetup(cardId: string): boolean {
  const effects = CARD_CATALOG.get(cardId)?.effects
  let weaponBuff = false,
    randomMinion = false
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const entry = value as Record<string, unknown>
    const target = entry.target as Record<string, unknown> | undefined
    if (entry.action === 'modify' && target?.controller === 'self') {
      weaponBuff ||=
        target.type === 'weapon' && typeof entry.attack === 'number' && entry.attack > 0
      randomMinion ||= target.type === 'minion' && target.selection === 'random'
    }
    Object.values(entry).forEach(visit)
  }
  visit(effects)
  return weaponBuff && randomMinion
}

/** The proof's public-information boundary, including rule history and allocators. */
export function publicOrderStateKey(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId
): string {
  type Card = OpeningMatchCheckpoint['state']['players'][number]['hand'][number]
  const known = (card: Card) => {
    if (!card.knownTo?.includes(actorId)) return { concealed: true }
    const definition = CARD_CATALOG.require(card.cardId)
    // Publicly identified opponent cards do not disclose concealed discounts.
    const visible = Object.fromEntries(
      Object.entries(card).filter(
        ([key]) =>
          ![
            'attack',
            'health',
            'enchantments',
            'costAdjustments',
            'creationOrdinal',
            'playOrder'
          ].includes(key)
      )
    )
    return {
      ...visible,
      startedInDeck: card.startedInDeck === true,
      baseCost: definition.cost,
      currentCost: definition.cost
    }
  }
  const stable = (_key: string, value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value
  return JSON.stringify(
    {
      schemaVersion: checkpoint.schemaVersion,
      nextEntityOrdinal: checkpoint.nextEntityOrdinal,
      devDeckRefillCounter: checkpoint.devDeckRefillCounter,
      setup: { ...checkpoint.setup, seed: undefined, recordEffectTrace: undefined },
      state: {
        ...checkpoint.state,
        effectTrace: undefined,
        // Opening deal records contain private identities and are not rule inputs.
        openingHistory: undefined,
        history: checkpoint.state.history
          ? {
              ...checkpoint.state.history,
              cardsPlayedThisGame: checkpoint.state.history.cardsPlayedThisGame.filter(
                (id) => !CARD_CATALOG.get(id)?.keywords.includes('secret')
              )
            }
          : undefined,
        players: checkpoint.state.players.map((player) => ({
          ...player,
          originalDeckCardIds:
            player.participantId === actorId
              ? [...(player.originalDeckCardIds ?? [])].sort()
              : undefined,
          pendingCostModifiers:
            player.participantId === actorId ? player.pendingCostModifiers : undefined,
          deckHasNoDuplicates:
            player.participantId === actorId ? player.deckHasNoDuplicates : false,
          hand: player.participantId === actorId ? player.hand : player.hand.map(known),
          revealedCards:
            player.participantId === actorId
              ? player.revealedCards
              : player.revealedCards?.map(known),
          discardedCards:
            player.participantId === actorId
              ? player.discardedCards
              : player.discardedCards?.map(known),
          // Keep known composition and entity facts, never future draw order.
          deck: {
            count: player.deck.length,
            known: player.deck
              .filter(
                (card) =>
                  (player.participantId === actorId && card.startedInDeck) ||
                  card.knownTo?.includes(actorId)
              )
              .map((card) => (player.participantId === actorId ? card : known(card)))
              .sort((a, b) =>
                JSON.stringify(a, stable).localeCompare(JSON.stringify(b, stable))
              )
          }
        }))
      }
    },
    stable
  )
}

export interface SingletonOrderTransition {
  readonly revision: number
  readonly commandKey: string
  readonly beforePublicState: string
  readonly afterPublicState: string
  readonly events: readonly OpeningMatchEvent[]
}

/** A conditional ordering benefit, not evidence that spending the card beats holding it. */
export function reviewChanceAttackOrder(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  commands: readonly TurnMatchCommand[],
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now(),
  maxDispatches = 28,
  committedSuffix: readonly TurnMatchCommand[] = []
) {
  const started = now()
  const stats = {
    dispatches: 0,
    outcomes: 0,
    targets: 0,
    abstained: false,
    durationMs: 0
  }
  let transition: SingletonOrderTransition | undefined
  const result = (improves = false) => {
    stats.durationMs = Math.max(0, now() - started)
    return { improves, stats, transition: improves ? transition : undefined }
  }
  const stop = () => shouldStop() || now() - started >= EXPERT_CHANCE_ORDER_MAX_MS
  const first = commands[0],
    card = commands.at(-1),
    state = checkpoint.state
  const singletonMinion =
    first?.type === 'attack-character' && first.attacker.kind === 'minion'
  if (
    !(
      commands.length === 2 ||
      (singletonMinion &&
        commands.length === 3 &&
        commands[1]?.type === 'use-hero-power')
    ) ||
    first?.type !== 'attack-character' ||
    first.defender.kind !== 'hero' ||
    card?.type !== 'play-card' ||
    commands.length + committedSuffix.length > 6 ||
    (!singletonMinion && committedSuffix.length > 0) ||
    [...commands, ...committedSuffix].some((c) => c.participantId !== actorId) ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.players.some((p) => p.secrets?.length)
  )
    return result()
  if (stop() || maxDispatches <= 0) {
    stats.abstained = true
    return result()
  }
  const base = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  const fair = { ...base, setup: { ...base.setup, recordEffectTrace: false } }
  if (
    singletonMinion &&
    publicOrderStateKey(checkpoint, actorId) !== publicOrderStateKey(fair, actorId)
  )
    return result()
  const cardId = state.players
    .find((p) => p.participantId === actorId)
    ?.hand.find((c) => c.instanceId === card.cardInstanceId)?.cardId
  if (!cardId) return result()
  const reordered = [...commands.slice(1), first, ...committedSuffix]
  const seeded = createSeededRng(fair.setup.seed)
  let armed = false,
    invalid = false,
    calls = 0,
    branch = 0,
    captureTransition = false
  let current: TurnMatchCommand | undefined
  let selection: RandomTargetSelection | undefined
  // These audit flags deliberately do not roll back with RNG snapshots.
  const reject = (): never => {
    invalid = true
    throw new Error('Unproved random selection')
  }
  const match = createOpeningMatch(
    fair.setup,
    fair.decks,
    {
      next: () => (armed ? reject() : seeded.next()),
      snapshot: () => seeded.snapshot(),
      restore: (value) => seeded.restore(value),
      nextTargetIndex: (info) => {
        calls++
        if (
          calls !== 1 ||
          current !== card ||
          info.sourceInstanceId !== card.cardInstanceId ||
          info.sourceCardId !== cardId ||
          !info.actionPath.startsWith('play-card.cast') ||
          info.targets.length < 1 ||
          info.targets.length > (singletonMinion ? 1 : 7) ||
          branch >= info.targets.length ||
          info.targets.some(
            (t) =>
              t.kind !== 'minion' || t.zone !== 'board' || t.participantId !== actorId
          ) ||
          info.selector.preserve ||
          (info.selector.count !== undefined && info.selector.count !== 1)
        )
          return reject()
        selection = structuredClone(info)
        seeded.next()
        return branch
      }
    },
    fair
  )
  armed = true
  const resetBranch = (outcome: number) => {
    branch = outcome
    calls = 0
    invalid = false
    selection = undefined
  }
  const run = (
    fork: OpeningMatchAnalysis,
    line: readonly TurnMatchCommand[],
    needsSelection = true
  ) => {
    for (const command of line) {
      if (stop() || stats.dispatches >= maxDispatches) {
        stats.abstained = true
        return undefined
      }
      current = command
      let dispatched
      const beforePublicState =
        captureTransition && command === card
          ? publicOrderStateKey(match.getCheckpoint(), actorId)
          : undefined
      try {
        if (
          !enumerateLegalCommands(fork, actorId).some(
            (c) => canonicalCommandKey(c) === canonicalCommandKey(command)
          )
        )
          return undefined
        stats.dispatches++
        dispatched = fork.dispatch(command)
      } catch {
        return undefined
      }
      const s = dispatched.state
      if (
        invalid ||
        !dispatched.accepted ||
        s.phase !== 'turns' ||
        s.activePlayerId !== actorId ||
        s.pendingDiscover ||
        s.pendingCardChoice ||
        s.pendingResolution ||
        revealsTacticalInformation(dispatched.events)
      )
        return undefined
      if (beforePublicState !== undefined)
        transition = {
          revision: s.revision - 1,
          commandKey: canonicalCommandKey(command),
          beforePublicState,
          afterPublicState: publicOrderStateKey(match.getCheckpoint(), actorId),
          events: structuredClone(dispatched.events)
        }
    }
    if (invalid || calls !== (needsSelection ? 1 : 0) || (needsSelection && !selection))
      return undefined
    return {
      checkpoint: match.getCheckpoint(),
      selection: selection as RandomTargetSelection | undefined
    }
  }
  const after = (
    line: readonly TurnMatchCommand[],
    outcome: number,
    capture = false
  ) => {
    resetBranch(outcome)
    captureTransition = capture
    transition = undefined
    return match.analyze((fork) => run(fork, line))
  }
  // The selected attack is deterministic. Share that exact prefix across
  // all card outcomes rather than reconstructing and dispatching it repeatedly.
  const selectedOutcomes = match.analyze((fork) => {
    resetBranch(0)
    if (!run(fork, [first], false)) return undefined
    const firstOutcome = after([...commands.slice(1), ...committedSuffix], 0)
    if (!firstOutcome?.selection) return undefined
    const outcomes = [firstOutcome]
    for (let index = 1; index < firstOutcome.selection.targets.length; index++) {
      const outcome = after([...commands.slice(1), ...committedSuffix], index)
      if (!outcome?.selection) return undefined
      outcomes.push(outcome)
    }
    return outcomes
  })
  if (!selectedOutcomes) return result()
  let domain: string | undefined
  for (let outcome = 0; outcome < selectedOutcomes.length; outcome++) {
    const selected = selectedOutcomes[outcome]!
    const changed = after(reordered, outcome, singletonMinion)
    if (!changed || stop()) {
      if (stop()) stats.abstained = true
      return result()
    }
    const selectedDomain = JSON.stringify(selected.selection)
    if (
      selectedDomain !== JSON.stringify(changed.selection) ||
      (domain && domain !== selectedDomain) ||
      !moreFaceDamageWithSameResources(selected.checkpoint, changed.checkpoint, actorId)
    )
      return result()
    domain = selectedDomain
    stats.targets = selected.selection!.targets.length
    stats.outcomes++
  }
  return result(stats.outcomes === stats.targets && stats.targets > 0)
}
