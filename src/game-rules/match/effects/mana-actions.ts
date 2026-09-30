import type { EffectFrame, DraftPlayer, SemanticEvent } from './effect-context'
import type { PlayerId } from '../match-types'
import type { ManaActionName, ManaCardAction } from '../../content/cards'
import { MAX_MANA } from './effect-primitives'

/** The immediate mana result of a temporary gain, before any other triggers. */
export function temporaryManaAfterGain(
  mana: { readonly available: number; readonly temporary?: number },
  amount: number
): { available: number; temporary: number } {
  const gain = Math.max(0, Math.floor(amount))
  const temporary = (mana.temporary ?? 0) + gain
  return { temporary, available: Math.min(MAX_MANA + temporary, mana.available + gain) }
}

/** Dynamic runtime effects use the same handler without claiming content validation.
 * Amount evaluation stays lazy so per-player RNG consumption remains unchanged.
 */
export type ManaActionInput<Amount = ManaCardAction['amount']> = {
  readonly player?: string
  readonly duration?: ManaCardAction['duration']
  readonly crystal?: 'empty' | 'full'
} & (
  | {
      readonly action: Exclude<ManaActionName, 'unlock-overload'>
      readonly amount: Amount
    }
  | { readonly action: 'unlock-overload'; readonly amount?: Amount }
)

/** Mutations are limited to the selected player's mana and overload state. */
export interface ManaActionContext {
  player(participantId: PlayerId): Pick<DraftPlayer, 'mana' | 'overload'>
  targetPlayers(
    action: Readonly<Record<string, unknown>>,
    frame: EffectFrame
  ): readonly PlayerId[]
  evaluate(value: unknown, frame: EffectFrame): number
  emit(
    frame: EffectFrame,
    action: string,
    path: string,
    data: Record<string, unknown>
  ): void
  emitSemantic(event: Omit<SemanticEvent, 'sequence'>): SemanticEvent
}

export function runManaAction<Amount>(
  action: ManaActionInput<Amount>,
  frame: EffectFrame,
  path: string,
  context: ManaActionContext
): void {
  const name = action.action
  switch (name) {
    case 'destroy-mana-crystal': {
      for (const participantId of context.targetPlayers(action, frame)) {
        const player = context.player(participantId)
        const amount = Math.max(0, Math.floor(context.evaluate(action.amount, frame)))
        player.mana.maximum = Math.max(0, player.mana.maximum - amount)
        player.mana.available = Math.min(player.mana.available, player.mana.maximum)
        context.emit(frame, name, path, { participantId, amount })
      }
      return
    }

    case 'gain-mana':
      for (const participantId of context.targetPlayers(action, frame)) {
        const player = context.player(participantId)
        const amount = Math.max(0, Math.floor(context.evaluate(action.amount, frame)))
        const duration = action.duration
        if (action.crystal === 'empty') {
          player.mana.maximum = Math.min(MAX_MANA, player.mana.maximum + amount)
        } else if (action.crystal === 'full') {
          const gained = Math.min(MAX_MANA - player.mana.maximum, amount)
          player.mana.maximum += gained
          player.mana.available = Math.min(MAX_MANA, player.mana.available + gained)
        } else if (duration === 'this-turn') {
          Object.assign(player.mana, temporaryManaAfterGain(player.mana, amount))
        } else {
          player.mana.available = Math.min(
            player.mana.maximum,
            player.mana.available + amount
          )
        }
        context.emit(frame, name, path, {
          participantId,
          amount,
          mana: { ...player.mana }
        })
      }
      return

    case 'overload': {
      const amount = Math.max(0, Math.floor(context.evaluate(action.amount, frame)))
      for (const participantId of context.targetPlayers(action, frame)) {
        const player = context.player(participantId)
        const previous = player.mana.overloadNextTurn ?? 0
        const nextOverload = Math.min(MAX_MANA, previous + amount)
        const appliedAmount = nextOverload - previous
        player.mana.overloadNextTurn = nextOverload
        player.overload = nextOverload
        context.emit(frame, name, path, {
          participantId,
          amount: appliedAmount,
          overloadNextTurn: nextOverload
        })
        context.emitSemantic({
          type: 'overload-applied',
          source: frame.source,
          target: {
            instanceId: `${participantId}:hero`,
            kind: 'hero',
            participantId,
            zone: 'hero'
          },
          controllerId: participantId,
          targetControllerId: participantId,
          amount: appliedAmount
        })
      }
      return
    }

    case 'unlock-overload': {
      for (const participantId of context.targetPlayers(action, frame)) {
        const player = context.player(participantId)
        const locked = player.mana.overloadLocked ?? 0
        player.mana = {
          ...player.mana,
          available: Math.min(player.mana.maximum, player.mana.available + locked),
          overloadLocked: 0
        }
        player.overload = 0
        context.emit(frame, name, path, { participantId, amount: locked })
      }
      return
    }
  }
}
