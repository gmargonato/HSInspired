import { CARD_CATALOG, asCardId } from '../../../game/content/cards'
import {
  asPlayerId,
  type OpeningCard,
  type TurnMatchCommand
} from '../../../game/match'
import { describe, expect, it, vi } from 'vitest'
import {
  isRemoteSecret,
  playedRemoteCard,
  RemoteCardPlayPreview
} from './remote-card-play-preview'
import { Container, Texture } from 'pixi.js'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { gsap } from '../../animation/animations'
import { MATCH_HISTORY_LAYOUT } from './match-history-layout'

const remoteId = asPlayerId('remote')
const spell: OpeningCard = {
  instanceId: 'spell-instance',
  cardId: asCardId('basic_fireball')
}

describe('automatic spell preview', () => {
  it.each(['local', 'remote'] as const)(
    'flies from the %s hero and waits through the reveal',
    async (side) => {
      const preview = new RemoteCardPlayPreview(new CardAssetResolver(), Texture.WHITE)
      const card = new Container()
      const internal = preview as unknown as { createCard(): Promise<Container> }
      const create = vi.spyOn(internal, 'createCard').mockResolvedValue(card)
      const definition = CARD_CATALOG.require('classic_counterspell')
      let done = false
      const job = preview
        .present(definition, undefined, { side, concealSecret: side === 'remote' })
        .then(() => {
          done = true
        })
      for (let tick = 0; tick < 6; tick++) await Promise.resolve()
      expect(create).toHaveBeenCalledWith(
        definition,
        undefined,
        side === 'remote',
        false,
        side
      )
      const origin =
        side === 'local'
          ? MATCH_HISTORY_LAYOUT.remoteCardPlay.localOrigin
          : MATCH_HISTORY_LAYOUT.remoteCardPlay.origin
      expect(card.x).toBe(origin.position.x - (origin.size.width * origin.scale!.x) / 2)
      expect(card.y).toBe(
        origin.position.y - (origin.size.height * origin.scale!.y) / 2
      )
      expect(card.scale.x).toBe(origin.scale!.x)
      const timeline = gsap.getTweensOf(card)[0]!.parent!
      expect(timeline.duration()).toBeCloseTo(1.3)
      preview.pauseAnimations()
      expect(timeline.paused()).toBe(true)
      preview.resumeAnimations()
      timeline.time(0.2)
      expect(card.x).toBeCloseTo(MATCH_HISTORY_LAYOUT.preview.source.position.x)
      expect(card.y).toBeCloseTo(MATCH_HISTORY_LAYOUT.preview.source.position.y)
      expect(card.scale.x).toBeCloseTo(MATCH_HISTORY_LAYOUT.preview.source.scale!.x)
      expect(done).toBe(false)
      timeline.progress(1)
      await job
      expect(card.destroyed).toBe(true)
      preview.dispose()
    }
  )

  it('releases pending artwork and animation waits on disposal', async () => {
    const preview = new RemoteCardPlayPreview(new CardAssetResolver(), Texture.WHITE)
    let release!: (card: Container) => void
    vi.spyOn(
      preview as unknown as { createCard(): Promise<Container> },
      'createCard'
    ).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const pending = preview.present(CARD_CATALOG.require('basic_fireball'))
    preview.dispose()
    await pending
    const lateCard = new Container()
    release(lateCard)
    await Promise.resolve()
    expect(lateCard.destroyed).toBe(true)

    const playing = new RemoteCardPlayPreview(new CardAssetResolver(), Texture.WHITE)
    const visible = playing.present(CARD_CATALOG.require('classic_counterspell'))
    for (let tick = 0; tick < 6; tick++) await Promise.resolve()
    expect(playing.children).toHaveLength(1)
    playing.dispose()
    await visible
  })
})

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
