import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import {
  asPlayerId,
  type OpeningCard,
  type TurnMatchCommand
} from '../../../game/match'
import { describe, expect, it } from 'vitest'
import { isRemoteSecret, playedRemoteCard } from './remote-card-play-preview'

const remoteId = asPlayerId('remote')
const spell: OpeningCard = {
  instanceId: 'spell-instance',
  cardId: asCardId('basic_fireball')
}

describe('playedRemoteCard', () => {
  it('does not preview potion ingredient choices as casts', () => {
    const command: TurnMatchCommand = {
      type: 'choose-card-option',
      participantId: remoteId,
      sourceCardInstanceId: 'turn-bonus',
      choice: 0
    }
    expect(playedRemoteCard(command, [spell])).toBeNull()
  })
  it('returns the hand card consumed by a remote play command', () => {
    const command: TurnMatchCommand = {
      type: 'play-card',
      participantId: remoteId,
      cardInstanceId: spell.instanceId
    }

    expect(playedRemoteCard(command, [spell])).toBe(spell)
  })

  it('ignores non-card commands and missing hand cards', () => {
    const endTurn: TurnMatchCommand = { type: 'end-turn', participantId: remoteId }
    const missingCard: TurnMatchCommand = {
      type: 'play-card',
      participantId: remoteId,
      cardInstanceId: 'missing'
    }

    expect(playedRemoteCard(endTurn, [spell])).toBeNull()
    expect(playedRemoteCard(missingCard, [spell])).toBeNull()
  })
})

describe('isRemoteSecret', () => {
  it('conceals secrets but leaves ordinary remote cards visible', () => {
    expect(isRemoteSecret(CARD_CATALOG.require('classic_noble_sacrifice'))).toBe(true)
    expect(isRemoteSecret(CARD_CATALOG.require('basic_fireball'))).toBe(false)
  })

  it('uses the same concealment decision as history for every playable card', async () => {
    const { MatchHistoryModel } = await import('./match-history-model')
    const localId = asPlayerId('local')
    const model = new MatchHistoryModel(localId)
    for (const definition of CARD_CATALOG.all) {
      const entry = model.record({
        type: 'history-action-resolved',
        action: 'card',
        participantId: remoteId,
        source: {
          id: 'played',
          participantId: remoteId,
          kind: 'card',
          cardId: definition.id
        },
        outcomes: []
      })
      if (entry.kind !== 'action') throw new Error('Expected action')
      expect(entry.source.concealedAs === 'secret', definition.id).toBe(
        isRemoteSecret(definition)
      )
      expect(entry.source.cardId, definition.id).toBe(
        isRemoteSecret(definition) ? null : definition.id
      )
    }
  })
})
