import {
  CARD_CATALOG,
  type CardId,
  type CardSummonPlacement
} from '../../content/cards'
import type { PlayerId } from '../match-types'
import type { DeterministicRng } from '../rng'
import type { DraftMinion, EffectFrame, EntityRef } from './effect-context'
import type { EffectQueries } from './effect-queries'

export type SummonActionName =
  'summon' | 'summon-copy' | 'summon-for-each' | 'summon-random'

/** Creation retains runtime ownership of IDs, board mutation, events and triggers. */
export interface SummonActionContext {
  readonly rng: Pick<DeterministicRng, 'next'>
  readonly queries: Pick<EffectQueries, 'evaluate' | 'otherPlayer' | 'matchesFilter'>
  actionCardId(
    action: Readonly<Record<string, unknown>>,
    frame?: EffectFrame
  ): CardId | null
  storedSummonController(frame: EffectFrame): PlayerId | null
  actionTargets(
    action: Readonly<Record<string, unknown>>,
    frame: EffectFrame
  ): readonly EntityRef[]
  sourceEntities(
    action: Readonly<Record<string, unknown>>,
    frame: EffectFrame
  ): readonly EntityRef[]
  currentMinion(ref: EntityRef): DraftMinion | null
  summonPosition(
    frame: EffectFrame,
    participantId: PlayerId,
    placement: CardSummonPlacement | undefined,
    summonIndex: number
  ): number
  createMinion(
    participantId: PlayerId,
    cardId: CardId,
    frame: EffectFrame,
    path: string,
    sourceInstanceId?: string,
    position?: number,
    copyFrom?: DraftMinion,
    modifications?: unknown
  ): EntityRef | null
}

export function runSummonAction(
  name: SummonActionName,
  action: Readonly<Record<string, unknown>>,
  frame: EffectFrame,
  path: string,
  context: SummonActionContext
): void {
  const summonedForStorage: EntityRef[] = []
  const storeSummons = (): void => {
    if (typeof action.storeAs === 'string')
      frame.stored.set(action.storeAs, summonedForStorage)
  }
  switch (name) {
    case 'summon': {
      const cardId = context.actionCardId(action, frame)
      if (!cardId) return
      const count = Math.max(0, context.queries.evaluate(action.count ?? 1, frame))
      const storedReference =
        typeof action.cardId === 'object' &&
        action.cardId !== null &&
        (action.cardId as Record<string, unknown>).reference ===
          'source.destroyed-card' &&
        action.controller === undefined
      const controller =
        typeof action.controller === 'string' && action.controller === 'opponent'
          ? context.queries.otherPlayer(frame.controllerId)
          : storedReference
            ? (context.storedSummonController(frame) ?? frame.controllerId)
            : frame.controllerId
      const placement =
        typeof action.placement === 'string'
          ? (action.placement as CardSummonPlacement)
          : undefined
      let summonIndex = 0
      for (let index = 0; index < count; index += 1) {
        const summoned = context.createMinion(
          controller,
          cardId,
          frame,
          `${path}.${index}`,
          undefined,
          context.summonPosition(frame, controller, placement, summonIndex)
        )
        if (summoned) {
          summonIndex += 1
          summonedForStorage.push(summoned)
        }
        if (
          summoned &&
          frame.event &&
          (action.asNewAttackTarget === true || action.asNewSpellTarget === true)
        ) {
          frame.event.redirectTarget = summoned
        }
      }
      storeSummons()
      return
    }
    case 'summon-copy': {
      const targets =
        action.target !== undefined
          ? context.actionTargets(action, frame)
          : context.sourceEntities(action, frame)
      const count =
        action.source !== undefined
          ? 1
          : Math.max(1, context.queries.evaluate(action.count ?? 1, frame))
      const placement =
        typeof action.placement === 'string'
          ? (action.placement as CardSummonPlacement)
          : undefined
      let summonIndex = 0
      for (const target of targets) {
        for (let index = 0; index < count; index += 1) {
          if (target.cardId) {
            const summoned = context.createMinion(
              frame.controllerId,
              target.cardId,
              frame,
              path,
              undefined,
              context.summonPosition(
                frame,
                frame.controllerId,
                placement,
                summonIndex
              ),
              context.currentMinion(target) ?? undefined,
              action.modifications
            )
            if (summoned) {
              summonIndex += 1
              summonedForStorage.push(summoned)
            }
          }
        }
      }
      storeSummons()
      return
    }
    case 'summon-for-each': {
      const cardId = context.actionCardId(action, frame)
      if (!cardId) return
      const sources = context.sourceEntities(action, frame)
      const placement =
        typeof action.placement === 'string'
          ? (action.placement as CardSummonPlacement)
          : undefined
      let summonIndex = 0
      for (let index = 0; index < sources.length; index += 1) {
        const summoned = context.createMinion(
          frame.controllerId,
          cardId,
          frame,
          `${path}.${index}`,
          undefined,
          context.summonPosition(frame, frame.controllerId, placement, summonIndex)
        )
        if (summoned) {
          summonIndex += 1
          summonedForStorage.push(summoned)
        }
      }
      storeSummons()
      return
    }
    case 'summon-random': {
      const count = Math.max(0, context.queries.evaluate(action.count ?? 1, frame))
      const pool = action.source === 'discarded-minions'
        ? context
            .sourceEntities(action, frame)
            .flatMap((candidate) => candidate.cardId ? [candidate.cardId] : [])
        : Array.isArray(action.pool)
        ? action.pool.filter((entry): entry is string => typeof entry === 'string')
        : CARD_CATALOG.all
            .filter(
              (card) =>
                card.collectible &&
                card.type === 'Minion' &&
                context.queries.matchesFilter(
                  {
                    instanceId: `${frame.controllerId}:pool:${card.id}`,
                    kind: 'card',
                    participantId: frame.controllerId,
                    zone: 'revealed',
                    cardId: card.id
                  },
                  action.filter,
                  frame
                )
            )
            .map((card) => card.id)
      const placement =
        typeof action.placement === 'string'
          ? (action.placement as CardSummonPlacement)
          : undefined
      let summonIndex = 0
      for (let index = 0; index < count; index += 1) {
        const cardId = pool[Math.floor(context.rng.next() * pool.length)] as
          CardId | undefined
        if (cardId) {
          const summoned = context.createMinion(
            frame.controllerId,
            cardId,
            frame,
            `${path}.${index}`,
            undefined,
            context.summonPosition(frame, frame.controllerId, placement, summonIndex)
          )
          if (summoned) {
            summonIndex += 1
            summonedForStorage.push(summoned)
          }
        }
      }
      storeSummons()
      return
    }
  }
}
