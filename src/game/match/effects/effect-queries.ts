import { cthunSnapshot } from '../cthun'
import { HERO_CATALOG } from '../../content/heroes'
import { cardHasTribe, type CardDefinition, type CardKeyword } from '../../content/cards'
import type {
  OpeningMatchState,
  OpeningPlayerState,
  OpeningCard,
  BoardMinion,
  BoardWeapon,
  BattlecryConditionFact
} from '../opening-match-types'
import type { PlayerId } from '../match-types'
import type { DeterministicRng } from '../rng'
import type { EffectFrame, EntityRef, SemanticEvent } from './effect-context'
import {
  isRecord,
  clamp,
  cardDefinition,
  cardHasTrigger,
  entityKey,
  MAX_BOARD_SIZE
} from './effect-primitives'

/** Read-only state access plus the resolution-owned randomness and budget hooks. */
export interface EffectQueryContext {
  readonly draft: Omit<OpeningMatchState, 'players'> & {
    readonly players: readonly OpeningPlayerState[]
  }
  readonly rng: DeterministicRng
  readonly destroyedWeaponSnapshots: ReadonlyMap<PlayerId, BoardWeapon>
  step(path: string): number
  playerIndex(participantId: PlayerId): 0 | 1
  player(participantId: PlayerId): OpeningPlayerState
  sourcePlayer(frame: EffectFrame): OpeningPlayerState
  currentMinion(ref: EntityRef): BoardMinion | null
  currentCard(ref: EntityRef): OpeningCard | null
  entityCard(ref: EntityRef): CardDefinition | undefined
  costForEntity(ref: EntityRef | undefined): number | undefined
  hasKeyword(ref: EntityRef, keyword: CardKeyword): boolean
  readMaximumHealth(ref: EntityRef): number
  readAttack(ref: EntityRef): number
  allEntities(): EntityRef[]
  isFrozen(ref: EntityRef): boolean
  frameFor(
    source: EntityRef,
    event: SemanticEvent | null,
    targets: readonly EntityRef[]
  ): EffectFrame
}

/** Deterministic selectors, numeric expressions, and conditions for one resolution. */
export class EffectQueries {
  constructor(private readonly context: EffectQueryContext) {}

  private conditionHand(
    player: OpeningPlayerState,
    frame: EffectFrame
  ): readonly OpeningCard[] {
    return frame.prospectiveCardPlay && player.participantId === frame.controllerId
      ? player.hand.filter((card) => card.instanceId !== frame.source.instanceId)
      : player.hand
  }

  /** Whitelisted own-hand checks cannot inspect an opponent's hidden cards or consume RNG. */
  previewHandCondition(
    value: unknown,
    frame: EffectFrame,
    effectIndex: number
  ): BattlecryConditionFact {
    const unknown: BattlecryConditionFact = {
      effectIndex,
      status: 'unknown',
      requirement:
        'See authored battlecry condition; not evaluated by this hand-only preview.'
    }
    if (
      !isRecord(value) ||
      value.type !== 'player-has-card-in-hand' ||
      (value.player !== undefined && value.player !== 'self') ||
      Object.keys(value).some((key) => !['type', 'player', 'filter'].includes(key))
    )
      return unknown
    const filter = value.filter
    if (
      filter !== undefined &&
      (!isRecord(filter) ||
        Object.keys(filter).some((key) => key !== 'tribe') ||
        (filter.tribe !== undefined && typeof filter.tribe !== 'string'))
    )
      return unknown
    const player = this.context.player(frame.controllerId)
    const qualifying = this.conditionHand(player, frame).filter((card) =>
      this.matchesFilter(
        {
          instanceId: card.instanceId,
          kind: 'card',
          participantId: player.participantId,
          zone: 'hand',
          cardId: card.cardId
        },
        filter,
        frame
      )
    )
    return {
      effectIndex,
      status: this.conditionMatches(value, frame) ? 'met' : 'not-met',
      requirement: `Hold ${isRecord(filter) && filter.tribe ? 'a ' + String(filter.tribe) : 'a card'} in your hand after playing this card; board minions do not count.`,
      qualifyingCardInstanceIds: qualifying.map((card) => card.instanceId)
    }
  }

  frameFor(
    source: EntityRef,
    event: SemanticEvent | null,
    targets: readonly EntityRef[]
  ): EffectFrame {
    return this.context.frameFor(source, event, targets)
  }

  /**
   * The card that caused an event may already have left its authoritative zone
   * by the time reactive effects resolve.  It is nevertheless a valid, typed
   * selector candidate for event-card effects (for example Gallywix).
   */
  eventCard(frame: EffectFrame): EntityRef | null {
    const event = frame.event
    if (!event?.cardId) return null
    return {
      instanceId: event.cardInstanceId ?? `event-card:${event.sequence}`,
      kind: 'card',
      participantId: event.controllerId ?? frame.controllerId,
      zone: 'revealed',
      cardId: event.cardId
    }
  }

  relativeController(value: unknown, frame: EffectFrame): PlayerId | null {
    if (value === 'self') return frame.controllerId
    if (value === 'opponent') return this.otherPlayer(frame.controllerId)
    if (value === 'any' || value === undefined) return null
    return typeof value === 'string' &&
      this.context.draft.players.some((player) => player.participantId === value)
      ? (value as PlayerId)
      : null
  }

  otherPlayer(participantId: PlayerId): PlayerId {
    return this.context.draft.players[
      this.context.playerIndex(participantId) === 0 ? 1 : 0
    ].participantId
  }

  matchesType(ref: EntityRef, type: unknown): boolean {
    if (typeof type !== 'string') return true
    const definition = this.context.entityCard(ref)
    switch (type) {
      case 'card':
      case 'event-card':
      case 'added-card':
      case 'drawn-card':
        return ref.kind === 'card'
      case 'minion-card':
        return ref.kind === 'card' && definition?.type === 'Minion'
      case 'spell-card':
        return ref.kind === 'card' && definition?.type === 'Spell'
      case 'spell':
        return ref.kind === 'card' && definition?.type === 'Spell'
      case 'character':
        return ref.kind === 'hero' || ref.kind === 'minion'
      case 'hero':
        return ref.kind === 'hero'
      case 'hero-power':
        return ref.kind === 'hero-power'
      case 'minion':
        return ref.kind === 'minion'
      case 'secret':
        return ref.kind === 'secret'
      case 'weapon':
        return ref.kind === 'weapon'
      default:
        return false
    }
  }

  targetForFrame(frame: EffectFrame): EntityRef | null {
    return (
      frame.targetContext ??
      frame.event?.target ??
      frame.chosenTargets[0] ??
      frame.lastEvent?.target ??
      null
    )
  }

  eventTargetForFrame(frame: EffectFrame): EntityRef | null {
    return (
      frame.event?.target ??
      frame.lastActionTarget ??
      frame.targetContext ??
      frame.lastEvent?.target ??
      frame.chosenTargets[0] ??
      null
    )
  }

  withTarget<T>(frame: EffectFrame, target: EntityRef, task: () => T): T {
    const previous = frame.targetContext
    frame.targetContext = target
    try {
      return task()
    } finally {
      frame.targetContext = previous
    }
  }

  matchesFilter(ref: EntityRef, filterValue: unknown, frame: EffectFrame): boolean {
    if (!isRecord(filterValue)) return true
    const filter = filterValue
    const minion = this.context.currentMinion(ref)
    const card = this.context.currentCard(ref)
    const definition = this.context.entityCard(ref)
    let matches = true
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'negate') continue
      let condition = true
      if (key === 'cardId') condition = ref.cardId === value
      else if (key === 'cardType') condition = definition?.type === value
      else if (key === 'cardClass') {
        const selfClass = HERO_CATALOG.get(
          this.context.player(frame.controllerId).heroId
        )?.classId
        const expected =
          value === 'opponent'
            ? HERO_CATALOG.get(
                this.context.player(this.otherPlayer(frame.controllerId)).heroId
              )?.classId
            : value
        condition =
          value === 'self'
            ? definition?.cardClass === selfClass
            : value === 'self-or-neutral'
              ? definition?.cardClass === selfClass ||
                definition?.cardClass === 'Neutral'
              : definition?.cardClass === expected
      } else if (key === 'cardClassIn') {
        condition =
          Array.isArray(value) &&
          typeof definition?.cardClass === 'string' &&
          value.includes(definition.cardClass)
      } else if (key === 'collectible') {
        condition = typeof value === 'boolean' && definition?.collectible === value
      } else if (key === 'cost') {
        const cost = card?.currentCost ?? card?.baseCost ?? definition?.cost
        const valueRecord = isRecord(value) ? value : null
        const rawExpected = valueRecord
          ? (valueRecord.value ?? valueRecord.reference ?? valueRecord.cost)
          : value
        const comparisonTarget = this.targetForFrame(frame)
        const targetCost =
          rawExpected === 'target-cost'
            ? this.context.costForEntity(comparisonTarget ?? undefined)
            : rawExpected === 'target.baseCost'
              ? comparisonTarget?.cardId
                ? cardDefinition(comparisonTarget.cardId)?.cost
                : undefined
              : rawExpected === 'event-card-cost'
                ? (frame.event?.card?.currentCost ??
                  frame.event?.card?.baseCost ??
                  (frame.event?.cardId
                    ? cardDefinition(frame.event.cardId)?.cost
                    : undefined))
                : rawExpected
        const offset =
          valueRecord && typeof valueRecord.offset === 'number' ? valueRecord.offset : 0
        const operator =
          typeof valueRecord?.operator === 'string'
            ? valueRecord.operator
            : typeof filter.operator === 'string'
              ? filter.operator
              : 'eq'
        condition =
          typeof cost === 'number' &&
          typeof targetCost === 'number' &&
          this.compare(cost, operator, targetCost + offset)
      } else if (key === 'damaged') {
        const damaged = minion
          ? minion.health < minion.maxHealth
          : ref.kind === 'hero'
            ? this.context.player(ref.participantId).hero.health <
              this.context.player(ref.participantId).hero.maxHealth
            : false
        condition = typeof value === 'boolean' ? damaged === value : damaged
      } else if (key === 'frozen') {
        const frozen = this.context.isFrozen(ref)
        condition = typeof value === 'boolean' ? frozen === value : frozen
      } else if (key === 'mortallyWounded') {
        const mortallyWounded = minion ? minion.health <= 0 : false
        condition =
          typeof value === 'boolean' ? mortallyWounded === value : mortallyWounded
      } else if (key === 'hasBattlecry') {
        const hasBattlecry = definition
          ? cardHasTrigger(definition, 'battlecry')
          : false
        condition = typeof value === 'boolean' ? hasBattlecry === value : hasBattlecry
      } else if (key === 'hasDeathrattle') {
        const hasDeathrattle = definition
          ? cardHasTrigger(definition, 'deathrattle') ||
            Boolean(minion?.deathrattles?.length)
          : false
        condition =
          typeof value === 'boolean' ? hasDeathrattle === value : hasDeathrattle
      } else if (key === 'keyword')
        condition = minion
          ? this.context.hasKeyword(ref, value as CardKeyword)
          : ref.kind === 'hero'
            ? this.context.hasKeyword(ref, value as CardKeyword)
            : ref.kind === 'card'
              ? this.context.hasKeyword(ref, value as CardKeyword)
              : Boolean(definition?.keywords.includes(value as CardKeyword))
      else if (key === 'overload')
        condition = Boolean(
          (definition?.effects ?? []).some((effect) =>
            effect.actions?.some((action) => action.action === 'overload')
          ) === value
        )
      else if (key === 'rarity') condition = definition?.rarity === value
      else if (key === 'rarityIn')
        condition =
          Array.isArray(value) &&
          typeof definition?.rarity === 'string' &&
          value.includes(definition.rarity)
      else if (key === 'expansionId') condition = definition?.expansionId === value
      else if (key === 'excludeInHand') {
        const hand =
          value === true
            ? this.context.player(frame.controllerId).hand
            : []
        condition =
          value !== true ||
          !hand.some((card) => card.cardId === ref.cardId)
      }
      else if (key === 'sparePart')
        condition =
          definition?.id.includes('spare') === value ||
          definition?.name.toLowerCase().includes('spare') === value
      else if (key === 'tribe') condition = cardHasTribe(definition, String(value))
      else if (key === 'type')
        condition = definition?.type === value || cardHasTribe(definition, String(value))
      else if (key === 'stat') {
        const printedOnly = filter.printedOnly === true
        const actual =
          value === 'health'
            ? printedOnly
              ? definition?.type === 'Minion'
                ? definition.health
                : definition?.type === 'Hero'
                  ? undefined
                  : undefined
              : this.context.readMaximumHealth(ref)
            : printedOnly
              ? definition?.type === 'Minion'
                ? definition.attack
                : definition?.type === 'Weapon'
                  ? definition.attack
                  : 0
              : this.context.readAttack(ref)
        const expected = isRecord(filter.value)
          ? this.evaluate(filter.value, frame)
          : filter.value
        condition =
          typeof actual === 'number' &&
          typeof expected === 'number' &&
          this.compare(actual, filter.operator, expected)
      } else if (key === 'operator' || key === 'value' || key === 'printedOnly')
        continue
      if (!condition) matches = false
    }
    if (isRecord(filter.negate))
      return matches && !this.matchesFilter(ref, filter.negate, frame)
    return filter.negate === true ? !matches : matches
  }

  compare(left: number, operator: unknown, right: number): boolean {
    switch (operator) {
      case 'gt':
        return left > right
      case 'gte':
        return left >= right
      case 'lt':
        return left < right
      case 'lte':
        return left <= right
      case 'eq':
      default:
        return left === right
    }
  }

  adjacentTo(ref: EntityRef): EntityRef[] {
    if (ref.kind !== 'minion') return []
    const player = this.context.player(ref.participantId)
    const index = player.board.findIndex(
      (minion) => minion.instanceId === ref.instanceId
    )
    if (index < 0) return []
    return [player.board[index - 1], player.board[index + 1]]
      .filter((minion): minion is BoardMinion => Boolean(minion))
      .map((minion) => ({
        instanceId: minion.instanceId,
        kind: 'minion' as const,
        participantId: player.participantId,
        zone: 'board' as const,
        cardId: minion.cardId
      }))
  }

  selectorPositionMatches(
    candidate: EntityRef,
    selector: Record<string, unknown>
  ): boolean {
    const rawPosition = selector.position
    if (rawPosition === undefined) return true
    const position = typeof rawPosition === 'string' ? rawPosition : null
    if (candidate.kind === 'card' && candidate.zone === 'deck') {
      const deck = this.context.player(candidate.participantId).deck
      const index = deck.findIndex((card) => card.instanceId === candidate.instanceId)
      if (index < 0) return false
      if (position === 'top' || position === 'first') {
        const count =
          typeof selector.count === 'number'
            ? Math.max(0, Math.floor(selector.count))
            : 1
        return index < count
      }
      if (position === 'bottom' || position === 'last') {
        const count =
          typeof selector.count === 'number'
            ? Math.max(0, Math.floor(selector.count))
            : 1
        return index >= Math.max(0, deck.length - count)
      }
      const numeric =
        typeof rawPosition === 'number' ? rawPosition : Number(rawPosition)
      return Number.isInteger(numeric) && numeric >= 0 && index === numeric
    }
    if (candidate.kind === 'minion' && candidate.zone === 'board') {
      const board = this.context.player(candidate.participantId).board
      const index = board.findIndex(
        (minion) => minion.instanceId === candidate.instanceId
      )
      const numeric =
        typeof rawPosition === 'number' ? rawPosition : Number(rawPosition)
      return Number.isInteger(numeric) && numeric >= 0 && index === numeric
    }
    return false
  }

  selectorMatches(
    candidate: EntityRef,
    selector: Record<string, unknown>,
    frame: EffectFrame
  ): boolean {
    if (
      candidate.kind === 'minion' &&
      this.context.currentMinion(candidate)?.dormant
    )
      return false
    const controller = this.relativeController(selector.controller, frame)
    if (controller && candidate.participantId !== controller) return false
    if (selector.zone && candidate.zone !== selector.zone) return false
    if (!this.selectorPositionMatches(candidate, selector)) return false
    if (!this.matchesType(candidate, selector.type)) return false
    if (
      selector.exclude === 'source' &&
      entityKey(candidate) === entityKey(frame.source)
    )
      return false
    if (
      selector.exclude === 'event-target' &&
      this.eventTargetForFrame(frame) &&
      entityKey(candidate) === entityKey(this.eventTargetForFrame(frame)!)
    )
      return false
    if (selector.excludeCardId && candidate.cardId === selector.excludeCardId)
      return false
    return this.matchesFilter(candidate, selector.filter, frame)
  }

  selectorCandidates(
    selector: Record<string, unknown>,
    frame: EffectFrame
  ): EntityRef[] {
    const selectorType = selector.type
    const eventCard = this.eventCard(frame)
    const contextualCards =
      selectorType === 'event-card'
        ? eventCard
          ? [eventCard]
          : []
        : selectorType === 'drawn-card'
          ? [
              ...frame.drawnCards,
              ...(frame.event?.kind === 'draw' && frame.event.target?.kind === 'card'
                ? [frame.event.target]
                : [])
            ]
          : selectorType === 'added-card'
            ? [...frame.addedCards]
            : null
    let candidates = (contextualCards ?? this.context.allEntities())
      .filter(
        (candidate, index, all) =>
          all.findIndex((other) => entityKey(other) === entityKey(candidate)) === index
      )
      .filter((candidate) => this.selectorMatches(candidate, selector, frame))
    const selection = selector.selection
    if (selection === 'other-player-hand') {
      candidates = candidates.filter(
        (candidate) =>
          candidate.kind === 'card' &&
          candidate.participantId !== frame.controllerId &&
          candidate.zone === 'hand'
      )
    }
    if (selection === 'hero')
      candidates = candidates.filter((candidate) => candidate.kind === 'hero')
    if (selection === 'next') {
      const sourceIndex = candidates.findIndex(
        (candidate) => entityKey(candidate) === entityKey(frame.source)
      )
      candidates =
        sourceIndex >= 0
          ? candidates.slice(sourceIndex + 1, sourceIndex + 2)
          : candidates.slice(0, 1)
    }
    if (selection === 'adjacent') {
      const anchor =
        selector.adjacentTo === 'event-source'
          ? (frame.event?.source ?? frame.source)
          : selector.adjacentTo === 'event-target'
            ? (this.eventTargetForFrame(frame) ?? frame.source)
            : frame.source
      candidates = this.adjacentTo(anchor).filter((candidate) =>
        this.selectorMatches(candidate, selector, frame)
      )
    }
    return candidates
  }

  chosenTarget(frame: EffectFrame, selector: Record<string, unknown>): EntityRef[] {
    const candidates = frame.chosenTargets.filter((target) =>
      this.selectorMatches(target, selector, frame)
    )
    if (candidates.length === 0) return []
    if (frame.chosenTargets.length === 1) return [candidates[0]!]
    const index = frame.selectedTargetCursor
    frame.selectedTargetCursor += 1
    return candidates[index]
      ? [candidates[index]!]
      : [candidates[candidates.length - 1]!]
  }

  /** Resolves a selector in stable zone/board order before count or random choice. */
  select(selectorValue: unknown, frame: EffectFrame): readonly EntityRef[] {
    this.context.step(`${frame.actionPath}:select`)
    if (typeof selectorValue === 'string') {
      if (selectorValue === 'source') return [frame.source]
      if (selectorValue === 'event-source' && frame.event?.source)
        return [frame.event.source]
      if (selectorValue === 'event-target')
        return frame.event?.target
          ? [frame.event.target]
          : frame.lastActionTarget
            ? [frame.lastActionTarget]
            : []
      return []
    }
    if (!isRecord(selectorValue)) return []
    const selector = selectorValue
    const selection = selector.selection
    if (selection === 'stored') {
      const reference = selector.reference
      const stored =
        typeof reference === 'string' ? (frame.stored.get(reference) ?? []) : []
      return stored
        .map((candidate) => ({ ...candidate }))
        .filter((candidate) => this.selectorMatches(candidate, selector, frame))
    }
    if (selection === 'source')
      return this.selectorMatches(frame.source, selector, frame) ? [frame.source] : []
    if (selection === 'event-source') {
      const eventSource = frame.event?.source
      return eventSource && this.selectorMatches(eventSource, selector, frame)
        ? [eventSource]
        : []
    }
    if (selection === 'event-target') {
      const eventTarget = frame.event?.target ?? frame.lastActionTarget
      return eventTarget && this.selectorMatches(eventTarget, selector, frame)
        ? [eventTarget]
        : []
    }
    if (selection === 'chosen') return this.chosenTarget(frame, selector)

    let candidates: EntityRef[]
    if (selection === 'chosen-and-adjacent') {
      const chosen = this.chosenTarget(frame, {
        ...selector,
        selection: 'chosen'
      })
      if (chosen.length === 0) return []
      const anchor = chosen[0]!
      const adjacent = this.adjacentTo(anchor)
      candidates = [anchor, ...adjacent].filter((candidate) =>
        this.selectorMatches(candidate, selector, frame)
      )
    } else {
      candidates = this.selectorCandidates(selector, frame)
    }

    if (selector.order === 'lowest-cost' || selector.order === 'highest-cost') {
      const direction = selector.order === 'lowest-cost' ? 1 : -1
      candidates = candidates
        .map((candidate, index) => ({
          candidate,
          index,
          cost: this.context.costForEntity(candidate) ?? Number.POSITIVE_INFINITY
        }))
        .sort(
          (left, right) =>
            direction * (left.cost - right.cost) || left.index - right.index
        )
        .map(({ candidate }) => candidate)
    }

    const count =
      typeof selector.count === 'number'
        ? clamp(selector.count, 0, candidates.length)
        : undefined
    if (selection === 'random') {
      if (frame.randomDamageExcluded.size > 0)
        candidates = candidates.filter((candidate) => {
          const key = entityKey(candidate)
          if (!frame.randomDamageExcluded.has(key)) return true
          const minion =
            candidate.kind === 'minion' ? this.context.currentMinion(candidate) : null
          if (minion && minion.health > 0) {
            frame.randomDamageExcluded.delete(key)
            return true
          }
          return false
        })
      const chosen: EntityRef[] = []
      const pool = [...candidates]
      const amount = count ?? 1
      for (let index = 0; index < amount && pool.length > 0; index += 1) {
        const selectedIndex = Math.floor(this.context.rng.next() * pool.length)
        chosen.push(...pool.splice(selectedIndex, 1))
      }
      candidates = chosen
    } else if (count !== undefined) {
      candidates = candidates.slice(0, count)
    }

    if (selector.preserve) {
      const preserveSelector = isRecord(selector.preserve)
        ? {
            controller: selector.controller,
            type: selector.type,
            zone: selector.zone,
            filter: selector.filter,
            exclude: selector.exclude,
            excludeCardId: selector.excludeCardId,
            ...selector.preserve
          }
        : {}
      const preserved = this.select(preserveSelector, frame)
      const preservedKeys = new Set(preserved.map(entityKey))
      frame.preserved.set(
        JSON.stringify(selector.preserve),
        preserved.map((candidate) => ({ ...candidate }))
      )
      candidates = candidates.filter(
        (candidate) => !preservedKeys.has(entityKey(candidate))
      )
    }
    return candidates
  }

  numericReference(
    reference: string,
    frame: EffectFrame,
    expression?: Record<string, unknown>
  ): number {
    const sourceMinion = this.context.currentMinion(frame.source)
    const sourceCard = this.context.currentCard(frame.source)
    const eventTarget = this.eventTargetForFrame(frame)
    const target = this.targetForFrame(frame)
    const targetMinion = target ? this.context.currentMinion(target) : null
    const targetCard = target ? this.context.currentCard(target) : null
    const owner = this.context.sourcePlayer(frame)
    const opponent = this.context.player(this.otherPlayer(frame.controllerId))
    switch (reference) {
      case 'available-board-slots':
        return Math.max(0, MAX_BOARD_SIZE - owner.board.length)
      case 'beasts-summoned-this-game':
        return (
          this.context.draft.history?.beastsSummonedByPlayer[frame.controllerId] ?? 0
        )
      case 'cards-played-earlier-this-turn':
        return Math.max(
          0,
          (this.context.draft.history?.cardsPlayedThisTurn.length ?? 0) - 1
        )
      case 'elementals-played-last-turn':
        return owner.elementalsPlayedLastTurn ?? (owner.elementalPlayedLastTurn ? 1 : 0)
      case 'cards-discarded-this-game':
        return (
          this.context.draft.history?.cardsDiscardedThisGameByPlayer?.[
            frame.controllerId
          ] ?? 0
        )
      case 'mana-overloaded-this-game':
        return (
          this.context.draft.history?.overloadedManaThisGameByPlayer?.[
            frame.controllerId
          ] ?? 0
        )
      case 'off-class-cards-added-to-hand-this-game':
        return (
          this.context.draft.history?.offClassCardsAddedToHandThisGameByPlayer?.[
            frame.controllerId
          ] ?? 0
        )
      case 'damage-dealt':
        return frame.damageDealt
      case 'last-damage-amount':
        return frame.lastDamageAmount
      case 'destroyed-weapon.attack': {
        return (
          this.context.destroyedWeaponSnapshots.get(frame.controllerId)?.attack ?? 0
        )
      }
      case 'destroyed-weapon.durability': {
        const weaponControllerId =
          frame.lastActionTarget?.kind === 'weapon'
            ? frame.lastActionTarget.participantId
            : frame.controllerId
        return (
          this.context.destroyedWeaponSnapshots.get(weaponControllerId)?.durability ?? 0
        )
      }
      case 'drawn-card.cost':
        return frame.drawnCards[0]
          ? (this.context.currentCard(frame.drawnCards[0])?.currentCost ??
              this.context.entityCard(frame.drawnCards[0])?.cost ??
              0)
          : (frame.event?.card?.currentCost ?? frame.event?.card?.baseCost ?? 0)
      case 'event-target.attack':
        return eventTarget ? this.context.readAttack(eventTarget) : 0
      case 'event-target.durability':
        return eventTarget && eventTarget.kind === 'weapon'
          ? (this.context.player(eventTarget.participantId).weapon?.durability ?? 0)
          : 0
      case 'event.damage':
        return frame.event?.damage ?? frame.event?.amount ?? 0
      case 'event.amount':
        return frame.event?.amount ?? frame.event?.damage ?? 0
      case 'event-card-cost':
        return (
          frame.event?.card?.currentCost ??
          frame.event?.card?.baseCost ??
          (frame.event?.cardId ? (cardDefinition(frame.event.cardId)?.cost ?? 0) : 0)
        )
      case 'friendly-spells-cast-this-game':
        return (
          this.context.draft.history?.spellsCastThisGameByPlayer?.[
            frame.controllerId
          ] ?? 0
        )
      case 'friendly-totems-summoned-this-game':
        return (
          this.context.draft.history?.totemsSummonedThisGameByPlayer?.[
            frame.controllerId
          ] ?? 0
        )
      case 'friendly-secrets-played-this-game':
        return (
          this.context.draft.history?.secretsPlayedThisGameByPlayer?.[
            frame.controllerId
          ] ?? 0
        )
      case 'manaSpent':
      case 'secretsDestroyed.count':
        return frame.storedValues.get(reference) ?? 0
      case 'discoveredCard.cost': {
        const discovered = frame.stored.get('discoveredCard')?.[0]
        return discovered
          ? (this.context.currentCard(discovered)?.currentCost ??
              this.context.entityCard(discovered)?.cost ??
              0)
          : (frame.storedValues.get(reference) ?? 0)
      }
      case 'target.baseCost':
        return target?.cardId ? (cardDefinition(target.cardId)?.cost ?? 0) : 0
      case 'hand-size-difference':
        if (expression?.opponent === true)
          return Math.max(0, opponent.hand.length - owner.hand.length)
        return Math.abs(owner.hand.length - opponent.hand.length)
      case 'health':
        return sourceMinion?.health ?? owner.hero.health
      case 'hero-damage':
        return Math.max(0, owner.hero.maxHealth - owner.hero.health)
      case 'hero-powers-used-this-game':
        return (
          this.context.draft.history?.heroPowersUsedByPlayer[frame.controllerId] ?? 0
        )
      case 'minions-died-this-turn':
        return this.context.draft.history?.minionsDiedThisTurn.length ?? 0
      case 'matching-entity-count':
        return isRecord(expression?.selector)
          ? this.select(expression.selector, frame).length
          : frame.event?.target
            ? 1
            : 0
      case 'other-cards-in-hand':
        return Math.max(0, owner.hand.length - (sourceCard ? 1 : 0))
      case 'other-minions-on-board':
        return Math.max(
          0,
          this.context.draft.players.flatMap((player) => player.board).length -
            (sourceMinion ? 1 : 0)
        )
      case 'removed-keyword-count':
        return frame.removedKeywordCount
      case 'self.hero.armor':
        return owner.hero.armor
      case 'self.hero.attack':
        return owner.hero.attack + (owner.weapon?.attack ?? 0)
      case 'source.attack':
        return (
          sourceMinion?.attack ??
          (frame.source.kind === 'weapon' ? (owner.weapon?.attack ?? 0) : 0)
        )
      case 'source.health':
        return sourceMinion?.health ?? owner.hero.health
      case 'source.weapon.attack':
        return owner.weapon?.attack ?? 0
      case 'source.weapon.durability':
        return owner.weapon?.durability ?? 0
      case 'destroyed-target.attack':
      case 'destroyed-target.health':
        return frame.storedValues.get(reference) ?? 0
      case 'target.attack':
        return target ? this.context.readAttack(target) : 0
      case 'target.health':
        if (targetMinion) return targetMinion.health
        if (target?.kind === 'hero')
          return this.context.player(target.participantId).hero.health
        return targetCard?.currentCost ?? 0
      default:
        return 0
    }
  }

  /** Evaluates a closed numeric expression at the action boundary. */
  evaluate(value: unknown, frame: EffectFrame, allowFull = false): number {
    this.context.step(`${frame.actionPath}:value`)
    if (typeof value === 'number') return value
    if (typeof value === 'string')
      return allowFull && (value === 'full' || value === 'all')
        ? Number.POSITIVE_INFINITY
        : 0
    if (!isRecord(value)) return 0
    if (value.condition !== undefined)
      return this.evaluate(
        this.conditionMatches(value.condition, frame)
          ? value.thenValue
          : value.elseValue,
        frame,
        allowFull
      )
    if (Array.isArray(value.random)) {
      const randomValues = value.random.filter(
        (entry): entry is number => typeof entry === 'number'
      )
      if (randomValues.length === 0) return 0
      return (
        randomValues[Math.floor(this.context.rng.next() * randomValues.length)] ??
        randomValues[0]!
      )
    }
    const reference =
      typeof value.reference === 'string'
        ? this.numericReference(value.reference, frame, value)
        : undefined
    const literal = typeof value.value === 'number' ? value.value : undefined
    if (value.snapshot === true || value.snapshot === 'at-death') {
      const snapshotKey = `${frame.actionPath}:snapshot`
      const previous = frame.storedValues.get(snapshotKey)
      if (previous !== undefined) return previous
      const snapshot = reference ?? literal ?? 0
      frame.storedValues.set(snapshotKey, snapshot)
      return snapshot
    }
    const base = reference ?? literal ?? 0
    if (value.operation === undefined && typeof value.multiplier === 'number')
      return base * value.multiplier
    switch (value.operation) {
      case 'multiply':
        return (
          base *
          (literal ?? (typeof value.multiplier === 'number' ? value.multiplier : 1))
        )
      case 'set':
        return literal ?? reference ?? 0
      case 'subtract':
        return literal === undefined ? -base : literal - (reference ?? 0)
      default:
        return base
    }
  }

  conditionMatches(value: unknown, frame: EffectFrame): boolean {
    if (typeof value === 'string') {
      return this.conditionMatches({ type: value }, frame)
    }
    if (!isRecord(value) || typeof value.type !== 'string') return false
    const condition = value
    const target = this.targetForFrame(frame)
    const relativePlayer = (candidate: unknown): OpeningPlayerState => {
      if (candidate === 'opponent')
        return this.context.player(this.otherPlayer(frame.controllerId))
      if (candidate === 'turn-player' && this.context.draft.activePlayerId)
        return this.context.player(this.context.draft.activePlayerId)
      if (
        typeof candidate === 'string' &&
        this.context.draft.players.some((player) => player.participantId === candidate)
      )
        return this.context.player(candidate as PlayerId)
      return this.context.player(frame.controllerId)
    }
    const player = relativePlayer(condition.player)
    const prospectiveDefinition =
      frame.prospectiveCardPlay && frame.sourceCardId
        ? cardDefinition(frame.sourceCardId)
        : undefined
    const isProspectiveController = (targetPlayer: OpeningPlayerState): boolean =>
      frame.prospectiveCardPlay === true &&
      targetPlayer.participantId === frame.controllerId
    const cardsInConditionHand = (
      targetPlayer: OpeningPlayerState
    ): readonly OpeningCard[] => this.conditionHand(targetPlayer, frame)
    const cardsPlayedEarlierThisTurn = Math.max(
      0,
      (this.context.draft.history?.cardsPlayedThisTurn.length ?? 0) -
        (frame.prospectiveCardPlay ? 0 : 1)
    )
    const matchingMinions = (
      targetPlayer: OpeningPlayerState,
      filter: unknown
    ): readonly EntityRef[] => {
      const candidates: EntityRef[] = targetPlayer.board.map((minion) => ({
        instanceId: minion.instanceId,
        kind: 'minion',
        participantId: targetPlayer.participantId,
        zone: 'board',
        cardId: minion.cardId
      }))
      if (
        isProspectiveController(targetPlayer) &&
        prospectiveDefinition?.type === 'Minion'
      ) {
        // The source remains a card reference so filters can read its authored
        // stats and keywords before a runtime minion instance exists.
        candidates.push(frame.source)
      }
      return candidates.filter((candidate) =>
        this.matchesFilter(candidate, filter, frame)
      )
    }
    switch (condition.type) {
      case 'player-turn':
        return this.context.draft.activePlayerId === player.participantId
      case 'board-has-minion-count':
        return this.compare(
          this.context.draft.players.reduce(
            (count, candidate) =>
              count + matchingMinions(candidate, condition.filter).length,
            0
          ),
          condition.operator,
          Number(condition.value)
        )
      case 'card-died-this-game':
        return condition.cardId === undefined
          ? (this.context.draft.history?.cardsDiedThisGame.length ?? 0) > 0
          : Boolean(
              this.context.draft.history?.cardsDiedThisGame.includes(
                String(condition.cardId)
              )
            )
      case 'combo':
      case 'combo-active':
        return cardsPlayedEarlierThisTurn > 0
      case 'not-combo':
        return cardsPlayedEarlierThisTurn === 0
      case 'drawn-card-matches':
        return (
          frame.drawnCards.length > 0
            ? frame.drawnCards
            : frame.event?.target?.kind === 'card' && frame.event.target
              ? [frame.event.target]
              : []
        ).some((card) => this.matchesFilter(card, condition.filter, frame))
      case 'event-player-had-minion-count': {
        const minionCountBeforePlay =
          frame.event?.minionCountBeforePlay ??
          frame.minionCountBeforePlay ??
          (frame.prospectiveCardPlay && prospectiveDefinition?.type === 'Minion'
            ? player.board.length
            : 0)
        return this.compare(
          minionCountBeforePlay,
          condition.operator,
          Number(condition.value)
        )
      }
      case 'player-controls-secret':
      case 'player-has-secret':
        return (player.secrets ?? []).length > 0
      case 'player-has-damaged-minion':
        return player.board.some((minion) => minion.health < minion.maxHealth)
      case 'player-has-card-in-hand':
        return cardsInConditionHand(player).some((card) =>
          this.matchesFilter(
            {
              instanceId: card.instanceId,
              kind: 'card',
              participantId: player.participantId,
              zone: 'hand',
              cardId: card.cardId
            },
            condition.filter,
            frame
          )
        )
      case 'player-has-hand-count':
        return this.compare(
          cardsInConditionHand(player).length,
          condition.operator,
          Number(condition.value)
        )
      case 'player-has-minion':
        return matchingMinions(player, condition.filter).length > 0
      case 'player-has-minion-count':
        return this.compare(
          matchingMinions(player, condition.filter).length,
          condition.operator,
          Number(condition.value)
        )
      case 'player-deck-has-no-duplicates': {
        const counts = new Map<string, number>()
        for (const card of player.deck)
          counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1)
        return [...counts.values()].every((count) => count === 1)
      }
      case 'player-deck-has-no-cost-cards': {
        const cost = Number(condition.cost ?? condition.value)
        return Number.isFinite(cost) &&
          player.deck.every((card) => cardDefinition(card.cardId)?.cost !== cost)
      }
      case 'player-deck-has-minion':
        return player.deck.some((card) => {
          if (cardDefinition(card.cardId)?.type !== 'Minion') return false
          return this.matchesFilter(
            {
              instanceId: card.instanceId,
              kind: 'card',
              participantId: player.participantId,
              zone: 'deck',
              cardId: card.cardId
            },
            condition.filter,
            frame
          )
        })
      case 'player-played-elemental-last-turn':
        return player.elementalPlayedLastTurn === true
      case 'player-was-healed-this-turn':
        return (this.context.draft.history?.healingThisTurn ?? 0) > 0
      case 'opponent-has-more-minions':
        return this.context.player(this.otherPlayer(player.participantId)).board.length >
          player.board.length
      case 'opponent-has-no-more-minions':
        return this.context.player(this.otherPlayer(player.participantId)).board.length <=
          player.board.length
      case 'repeat-ended-without-minion-death':
        return frame.storedValues.get('repeat.minions-died') === 0
      case 'player-has-weapon':
        return (
          player.weapon !== null ||
          (isProspectiveController(player) && prospectiveDefinition?.type === 'Weapon')
        )
      case 'player-health-gt':
        return player.hero.health > Number(condition.value)
      case 'player-health-lte':
        return player.hero.health <= Number(condition.value)
      case 'player-maximum-mana-gte':
        return player.mana.maximum >= Number(condition.value)
      case 'player-lacks-minion':
        return matchingMinions(player, condition.filter).length === 0
      case 'player-lacks-weapon':
        return (
          player.weapon === null &&
          !(isProspectiveController(player) && prospectiveDefinition?.type === 'Weapon')
        )
      case 'source-damaged': {
        const minion = this.context.currentMinion(frame.source)
        if (minion) return minion.health < minion.maxHealth
        if (frame.source.kind === 'hero') {
          const hero = this.context.player(frame.source.participantId).hero
          return hero.health < hero.maxHealth
        }
        return false
      }
      case 'target-damaged': {
        if (!target) return false
        const minion = this.context.currentMinion(target)
        if (minion) return minion.health < minion.maxHealth
        if (target.kind === 'hero') {
          const hero = this.context.player(target.participantId).hero
          return hero.health < hero.maxHealth
        }
        return false
      }
      case 'target-died':
        if (
          frame.lastEvent?.type === 'minion-died' ||
          frame.event?.type === 'minion-died'
        )
          return true
        return Boolean(
          target?.kind === 'minion' &&
          (this.context.currentMinion(target)?.health ?? 0) <= 0
        )
      case 'cthun-attack-at-least':
        return (
          (cthunSnapshot(player).attack ?? 6) >=
          Number(condition.value ?? condition.minimum ?? 0)
        )
      case 'defender-died-from-combat': {
        const event =
          frame.event?.type === 'attack-resolved'
            ? frame.event
            : frame.lastEvent?.type === 'attack-resolved'
              ? frame.lastEvent
              : null
        if (!event || event.defenderDied !== true) return false
        if (condition.sourceMustSurvive !== true) return true
        return (
          frame.source.kind === 'minion' &&
          (this.context.currentMinion(frame.source)?.health ?? 0) > 0
        )
      }
      case 'player-has-spell-damage': {
        const spellDamage =
          (player.hero.spellDamage ?? 0) +
          player.board.reduce((sum, minion) => sum + (minion.spellDamage ?? 0), 0)
        return spellDamage >= Number(condition.minimum ?? condition.value ?? 1)
      }
      case 'target-matches':
        return Boolean(
          target &&
          (condition.exclude !== true ||
            entityKey(target) !== entityKey(frame.source)) &&
          this.matchesFilter(target, condition.filter, frame)
        )
      case 'target-frozen':
        return Boolean(target && this.context.isFrozen(target))
      case 'target-is-friendly-demon': {
        return Boolean(
          target &&
          target.participantId === frame.controllerId &&
          cardHasTribe(this.context.entityCard(target), 'Demon')
        )
      }
      case 'target-is-not-friendly-demon': {
        return Boolean(
          target &&
          !(
            target.participantId === frame.controllerId &&
            cardHasTribe(this.context.entityCard(target), 'Demon')
          )
        )
      }
      case 'target-not-frozen':
        return Boolean(target && !this.context.isFrozen(target))
      case 'target-survived':
        if (!target) return false
        if (target.kind === 'hero')
          return this.context.player(target.participantId).hero.health > 0
        if (target.kind !== 'minion') return false
        return (this.context.currentMinion(target)?.health ?? 0) > 0
      default:
        return false
    }
  }
}
