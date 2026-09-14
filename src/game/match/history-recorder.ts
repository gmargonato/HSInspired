import { cthunCardRulesText, CTHUN_ID } from './cthun'
import { CARD_CATALOG, type CardId } from '../content/cards'
import type { PlayerId } from './match-types'
import type {
  HistoryActionOutcome,
  HistoryEffectRecordedEvent,
  HistoryEntitySnapshot,
  OpeningMatchState
} from './opening-match-types'
import { effectiveBoardMinionKeywords } from './rules/minion-attack-state'
import { boardMinionAbilityMarkers } from './rules/minion-abilities'
import { spellDamageRulesText } from './spell-damage'

/** Copies only visible entity state; never retains a board, deck, or runtime object. */
export function historySnapshot(
  state: OpeningMatchState,
  participantId: PlayerId,
  instanceId: string,
  cardId: CardId | null = null
): HistoryEntitySnapshot {
  for (const player of state.players) {
    const base = { id: instanceId, participantId: player.participantId }
    if (instanceId === `${player.participantId}:hero`) {
      const hero = player.hero
      return {
        ...base,
        kind: 'hero',
        cardId: null,
        heroId: player.heroId,
        zone: 'hero',
        attack: hero.attack + (player.weapon?.attack ?? 0),
        health: hero.health,
        maxHealth: hero.maxHealth,
        armor: hero.armor,
        spellDamage: hero.spellDamage ?? 0,
        immune: hero.immune,
        publicIdentity: true,
        keywords: [...(hero.keywords ?? [])],
        frozen: (hero.frozenUntilTurn ?? -1) >= state.turnNumber
      }
    }
    const minion = player.board.find((entity) => entity.instanceId === instanceId)
    if (minion)
      return {
        ...base,
        kind: 'minion',
        cardId: minion.cardId,
        ...(minion.cardId === CTHUN_ID
          ? {
              rulesText: cthunCardRulesText(
                minion,
                CARD_CATALOG.require(CTHUN_ID).rulesText
              )
            }
          : {}),
        zone: 'board',
        ownerId: minion.ownerId ?? player.participantId,
        publicIdentity: true,
        attack: minion.attack,
        health: minion.health,
        maxHealth: minion.maxHealth,
        keywords: [...effectiveBoardMinionKeywords(minion, state.turnNumber)],
        abilities: Object.entries(
          boardMinionAbilityMarkers(
            minion,
            CARD_CATALOG.require(minion.cardId),
            state.turnNumber
          )
        )
          .filter(([, enabled]) => enabled)
          .map(([name]) => name),
        silenced: minion.silenced,
        frozen:
          minion.frozenUntilTurn !== null &&
          minion.frozenUntilTurn !== undefined &&
          minion.frozenUntilTurn >= state.turnNumber,
        divineShield: minion.divineShield,
        immune: minion.immune,
        spellDamage: minion.spellDamage ?? 0
      }
    const weapon = player.weapon
    if (weapon?.instanceId === instanceId)
      return {
        ...base,
        kind: 'weapon',
        cardId: weapon.cardId,
        zone: 'weapon',
        publicIdentity: true,
        attack: weapon.attack,
        durability: weapon.durability,
        maxDurability: weapon.maxDurability
      }
    const card = [
      ...player.hand,
      ...player.deck,
      ...(player.revealedCards ?? []),
      ...(player.discardedCards ?? [])
    ].find((entity) => entity.instanceId === instanceId)
    if (card) {
      const definition = CARD_CATALOG.get(card.cardId)
      return {
        ...base,
        kind: 'card',
        cardId: card.cardId,
        zone: card.zone,
        ownerId: card.ownerId ?? player.participantId,
        knownTo: card.knownTo ? [...card.knownTo] : undefined,
        publicIdentity: false,
        baseCost: card.baseCost,
        currentCost: card.currentCost,
        attack: card.attack,
        health: card.health,
        ...(definition ? { rulesText: spellDamageRulesText(definition, player) } : {})
      }
    }
  }
  return { id: instanceId, participantId, kind: cardId ? 'card' : 'hidden', cardId }
}

const EFFECT_KINDS: Readonly<Record<string, HistoryActionOutcome['kind']>> = {
  'cast-spell': 'cast-spell',
  damage: 'damage',
  restore: 'heal',
  'gain-armor': 'armor',
  freeze: 'freeze',
  summon: 'summon-board',
  'add-to-hand': 'create-hand',
  draw: 'draw',
  destroy: 'destroy',
  modify: 'buff',
  'buff-cthun': 'buff',
  'shuffle-dead-cthun': 'shuffle-deck',
  silence: 'silence',
  'return-to-hand': 'return-hand',
  'shuffle-into-deck': 'shuffle-deck',
  discard: 'discard',
  burn: 'burn',
  transform: 'transform',
  'take-control': 'control',
  equip: 'equip',
  'change-cost': 'state',
  'grant-keyword': 'state',
  'grant-keywords': 'state',
  'grant-random-keyword': 'state',
  'remove-keyword': 'state',
  'grant-trigger': 'state',
  'set-health': 'state',
  'set-attack': 'state',
  'swap-stats': 'state'
}

/** One recorder per resolution. Snapshots survive removal without retaining full states. */
export class HistoryRecorder {
  private readonly previous = new Map<string, HistoryEntitySnapshot>()
  private readonly sources = new Map<string, HistoryEntitySnapshot>()
  private readonly latest = new Map<
    string,
    { outcomes: readonly HistoryActionOutcome[] }
  >()

  constructor(initial: OpeningMatchState) {
    this.prime(initial, `resolution:${initial.revision + 1}`)
  }

  private prime(initial: OpeningMatchState, resolutionId: string): void {
    for (const player of initial.players) {
      const ids = [
        `${player.participantId}:hero`,
        ...player.board.map((m) => m.instanceId),
        ...player.hand.map((c) => c.instanceId)
      ]
      if (player.weapon) ids.push(player.weapon.instanceId)
      for (const id of ids) {
        const snapshot = historySnapshot(initial, player.participantId, id)
        this.previous.set(id, snapshot)
        this.sources.set(`${resolutionId}:root:${id}`, snapshot)
      }
    }
  }

  beginCause(
    state: OpeningMatchState,
    causeId: string,
    participantId: PlayerId,
    sourceId: string,
    cardId: CardId | null
  ): void {
    const current = historySnapshot(state, participantId, sourceId, cardId)
    this.sources.set(
      `${causeId}:${sourceId}`,
      current.zone ? current : (this.previous.get(sourceId) ?? current)
    )
  }

  /** Finish derived stats at the engine's existing aura checkpoint, without changing rules. */
  settle(state: OpeningMatchState): void {
    for (const [id, fact] of this.latest) {
      const target = fact.outcomes.find((outcome) => outcome.target.id === id)?.target
      if (!target) continue
      const current = historySnapshot(state, target.participantId, id, target.cardId)
      if (
        !current.zone ||
        current.zone !== target.zone ||
        current.cardId !== target.cardId
      )
        continue
      const settled = { ...target, ...current, publicIdentity: target.publicIdentity }
      fact.outcomes = fact.outcomes.map((outcome) =>
        outcome.target.id === id ? { ...outcome, target: settled } : outcome
      )
      this.previous.set(id, settled)
    }
    // Aura recalculation emits no effects. Attribute its collateral changes to the
    // recorded summon/removal/silence of the aura source, not to a later draw trigger.
    const auraCause = [...this.latest.values()].findLast((fact) =>
      fact.outcomes.some(
        (outcome) =>
          ['summon-board', 'death', 'destroy', 'silence', 'control'].includes(
            outcome.kind
          ) &&
          outcome.target.cardId &&
          CARD_CATALOG.get(outcome.target.cardId)?.effects.some(
            (effect) => effect.trigger === 'aura'
          )
      )
    )
    if (!auraCause) return
    for (const player of state.players)
      for (const minion of player.board) {
        if (this.latest.has(minion.instanceId)) continue
        const before = this.previous.get(minion.instanceId)
        if (!before) continue
        const target = historySnapshot(state, player.participantId, minion.instanceId)
        if (
          before.attack === target.attack &&
          before.health === target.health &&
          before.maxHealth === target.maxHealth &&
          before.spellDamage === target.spellDamage &&
          JSON.stringify(before.keywords) === JSON.stringify(target.keywords)
        )
          continue
        auraCause.outcomes = [...auraCause.outcomes, { kind: 'state', before, target }]
        this.latest.set(minion.instanceId, auraCause)
        this.previous.set(minion.instanceId, target)
      }
  }

  remember(state: OpeningMatchState, participantId: PlayerId, id: string): void {
    this.previous.set(id, historySnapshot(state, participantId, id))
  }

  capture(
    state: OpeningMatchState,
    context: {
      readonly sourceId: string
      readonly cardId: CardId | null
      readonly participantId: PlayerId
      readonly causeId: string
      readonly parentActionId: string
    },
    action: string,
    data: Readonly<Record<string, unknown>> = {}
  ): HistoryEffectRecordedEvent | null {
    const kind = EFFECT_KINDS[action]
    if (!kind || data.replaced === true || data.fatigue !== undefined) return null
    if (kind === 'damage' && data.amount === 0) return null
    const id =
      typeof data.target === 'string'
        ? data.target
        : typeof data.instanceId === 'string'
          ? data.instanceId
          : null
    if (!id) return null
    const participantId =
      typeof data.participantId === 'string'
        ? (data.participantId as PlayerId)
        : context.participantId
    const cardId = typeof data.cardId === 'string' ? (data.cardId as CardId) : null
    const before =
      action === 'buff-cthun'
        ? (data.before as HistoryEntitySnapshot)
        : this.previous.get(id)
    let target =
      action === 'buff-cthun'
        ? (data.snapshot as HistoryEntitySnapshot)
        : historySnapshot(state, participantId, id, cardId)
    if (kind === 'cast-spell')
      target = {
        ...target,
        publicIdentity: true,
        ...(cardId && CARD_CATALOG.get(cardId)?.keywords.includes('secret')
          ? { secretCast: true }
          : {})
      }
    if (!target.zone && before && action !== 'buff-cthun') target = { ...before }
    if (kind === 'destroy' || data.burned === true)
      target = {
        ...target,
        zone: data.burned === true ? 'discarded' : 'graveyard',
        ...(target.health !== undefined ? { health: 0 } : {})
      }
    if (kind === 'shuffle-deck' || kind === 'burn' || kind === 'return-hand')
      target = { ...target, publicIdentity: true }
    const number = (key: string): number =>
      typeof data[key] === 'number' ? (data[key] as number) : 0
    const healthDamage =
      kind === 'damage'
        ? Math.min(number('actualDamage'), before?.health ?? Infinity)
        : 0
    const armorDamage = kind === 'damage' ? number('armorDamage') : 0
    let resultKind = data.burned === true ? ('burn' as const) : kind
    if (kind === 'damage' && healthDamage + armorDamage === 0)
      resultKind = data.shieldConsumed === true ? 'shield-lost' : 'prevented'
    this.previous.set(id, target)
    const sourceKey = `${context.causeId}:${context.sourceId}`
    let source = this.sources.get(sourceKey)
    if (!source) {
      source = historySnapshot(
        state,
        context.participantId,
        context.sourceId,
        context.cardId
      )
      if (!source.zone)
        source =
          this.previous.get(context.sourceId) ??
          historySnapshot(
            state,
            context.participantId,
            context.sourceId,
            context.cardId
          )
      this.sources.set(sourceKey, source)
    }
    const outcome: HistoryActionOutcome = {
      kind: resultKind,
      target,
      before,
      ...(kind === 'damage'
        ? { amount: healthDamage + armorDamage, healthDamage, armorDamage }
        : {}),
      ...(kind === 'heal' || kind === 'armor' ? { amount: number('amount') } : {})
    }
    const fact = {
      type: 'history-effect-recorded' as const,
      causeId: context.causeId,
      parentActionId: context.parentActionId,
      source,
      outcomes: [
        outcome,
        ...(kind === 'damage' && target.health === 0
          ? [{ kind: 'death' as const, target }]
          : [])
      ]
    }
    this.latest.set(id, fact)
    return fact
  }
}
