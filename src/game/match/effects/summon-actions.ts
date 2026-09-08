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
  actionCardId(action: Readonly<Record<string, unknown>>): CardId | null
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
    copyFrom?: DraftMinion
  ): EntityRef | null
}

export function runSummonAction(
  name: SummonActionName,
  action: Readonly<Record<string, unknown>>,
  frame: EffectFrame,
  path: string,
  context: SummonActionContext
): void {
  switch (name) {
    case 'summon': {
      const cardId = context.actionCardId(action)
      if (!cardId) return
      const count = Math.max(0, context.queries.evaluate(action.count ?? 1, frame))
      const controller =
        typeof action.controller === 'string' && action.controller === 'opponent'
          ? context.queries.otherPlayer(frame.controllerId)
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
        if (summoned) summonIndex += 1
        if (
          summoned &&
          frame.event &&
          (action.asNewAttackTarget === true || action.asNewSpellTarget === true)
        ) {
          frame.event.redirectTarget = summoned
        }
      }
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
      for (const target of targets)
        for (let index = 0; index < count; index += 1)
          if (target.cardId)
            if (
              context.createMinion(
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
                context.currentMinion(target) ?? undefined
              )
            )
              summonIndex += 1
      return
    }
    case 'summon-for-each': {
      const cardId = context.actionCardId(action)
      if (!cardId) return
      const sources = context.sourceEntities(action, frame)
      const placement =
        typeof action.placement === 'string'
          ? (action.placement as CardSummonPlacement)
          : undefined
      let summonIndex = 0
      for (let index = 0; index < sources.length; index += 1)
        if (
          context.createMinion(
            frame.controllerId,
            cardId,
            frame,
            `${path}.${index}`,
            undefined,
            context.summonPosition(frame, frame.controllerId, placement, summonIndex)
          )
        )
          summonIndex += 1
      return
    }
    case 'summon-random': {
      const count = Math.max(0, context.queries.evaluate(action.count ?? 1, frame))
      const pool = Array.isArray(action.pool)
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
        if (cardId)
          if (
            context.createMinion(
              frame.controllerId,
              cardId,
              frame,
              `${path}.${index}`,
              undefined,
              context.summonPosition(frame, frame.controllerId, placement, summonIndex)
            )
          )
            summonIndex += 1
      }
      return
    }
  }
}
