import type { PlayerId } from '../match-types'
import type { OpeningPlayerState } from '../opening-match-types'
import { cardDefinition } from './effect-primitives'

/** Current allowance, including additional uses and disabling board auras. */
export function heroPowerUseLimit(
  state: {
    readonly players: readonly Pick<
      OpeningPlayerState,
      'participantId' | 'board' | 'heroPower'
    >[]
  },
  participantId: PlayerId
): number {
  if (
    state.players.find((player) => player.participantId === participantId)?.heroPower
      .disabledThisTurn
  )
    return 0
  let limit = 1
  for (const boardPlayer of state.players) {
    for (const minion of boardPlayer.board) {
      if (minion.silenced) continue
      const definition = cardDefinition(minion.cardId)
      for (const block of definition?.effects ?? []) {
        if (block.trigger !== 'aura') continue
        for (const action of block.actions ?? []) {
          if (action.action !== 'modify-hero-power-uses') continue
          if (action.disabled === true) return 0
          if (
            action.unlimited === true &&
            (action.player === 'each' || boardPlayer.participantId === participantId)
          )
            limit = Number.POSITIVE_INFINITY
          if (
            typeof action.heroPowerUsesPerTurn === 'number' &&
            (action.player === 'each' || boardPlayer.participantId === participantId)
          )
            limit = Math.max(limit, Math.floor(action.heroPowerUsesPerTurn))
        }
      }
    }
  }
  return limit
}
