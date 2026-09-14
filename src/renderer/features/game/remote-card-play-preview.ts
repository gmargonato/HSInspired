import { cthunCardRulesText } from '../../../game/match/cthun'
import type { CardDefinition } from '../../../game/content/cards'
import { isSecretCardPlay } from '../../../game/match/history-visibility'
import type { OpeningCard, TurnMatchCommand } from '../../../game/match'
import { Container, Sprite, type Texture } from 'pixi.js'
import { CardView } from '../../rendering/cards/card-view'
import type { LayoutPlacement } from '../../rendering/layout'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { Actor } from '../../ui/components/actor'
import { MATCH_HISTORY_LAYOUT } from './match-history-layout'

function topLeftForCard(placement: LayoutPlacement): {
  readonly x: number
  readonly y: number
} {
  const scaleX = placement.scale?.x ?? 1
  const scaleY = placement.scale?.y ?? 1
  return {
    x: placement.position.x - placement.anchor.x * placement.size.width * scaleX,
    y: placement.position.y - placement.anchor.y * placement.size.height * scaleY
  }
}

/** Only playing a hand card produces a cast preview; crafting is a choice. */
export function playedRemoteCard(
  command: TurnMatchCommand,
  hand: readonly OpeningCard[]
): OpeningCard | null {
  if (command.type !== 'play-card') return null
  return hand.find((card) => card.instanceId === command.cardInstanceId) ?? null
}

export function isRemoteSecret(definition: CardDefinition): boolean {
  return isSecretCardPlay(definition)
}

/**
 * Shared card flight for remote hand plays and either player's automatic spells.
 * Callers await it when a reveal must finish before its effects begin.
 */
export class RemoteCardPlayPreview extends Actor {
  private sequence = 0
  private cancelPending: (() => void) | null = null

  constructor(
    private readonly resolver: CardAssetResolver,
    private readonly secretTexture: Texture
  ) {
    super()
    this.label = 'game.remote-card-play-preview'
    this.eventMode = 'none'
  }

  async present(
    definition: CardDefinition,
    snapshot?: OpeningCard,
    options: { readonly side: 'local' | 'remote'; readonly concealSecret: boolean } = {
      side: 'remote',
      concealSecret: true
    }
  ): Promise<void> {
    const sequence = ++this.sequence
    this.clearActiveCard()
    if (this.destroyed) return

    const concealSecret = options.concealSecret && isRemoteSecret(definition)
    const cancelled = new Promise<null>((resolve) => {
      this.cancelPending = () => resolve(null)
    })
    const creating = this.createCard(definition, snapshot, concealSecret)
    void creating.then(
      (card) => {
        if (sequence !== this.sequence || this.destroyed)
          card.destroy({ children: true })
      },
      () => undefined
    )
    const card = await Promise.race([creating, cancelled])
    if (!card) return
    if (sequence !== this.sequence || this.destroyed) {
      if (!card.destroyed) card.destroy({ children: true })
      return
    }

    const origin =
      options.side === 'local'
        ? MATCH_HISTORY_LAYOUT.remoteCardPlay.localOrigin
        : MATCH_HISTORY_LAYOUT.remoteCardPlay.origin
    const destination = MATCH_HISTORY_LAYOUT.preview.source
    const originPosition = topLeftForCard(origin)
    const destinationPosition = topLeftForCard(destination)
    card.label = concealSecret
      ? 'game.remote-card-play-preview.secret'
      : `game.remote-card-play-preview.${definition.id}`
    card.eventMode = 'none'
    card.position.set(originPosition.x, originPosition.y)
    card.scale.set(origin.scale!.x, origin.scale!.y)
    this.addChild(card)

    const timeline = this.timeline()
      .to(card, {
        x: destinationPosition.x,
        y: destinationPosition.y,
        duration: MATCH_HISTORY_LAYOUT.remoteCardPlay.travelDuration,
        ease: 'power2.in'
      })
      .to(
        card.scale,
        {
          x: destination.scale!.x,
          y: destination.scale!.y,
          duration: MATCH_HISTORY_LAYOUT.remoteCardPlay.travelDuration,
          ease: 'power2.in'
        },
        0
      )
      .to({}, { duration: MATCH_HISTORY_LAYOUT.remoteCardPlay.holdDuration })
      .to(card, {
        alpha: 0,
        duration: MATCH_HISTORY_LAYOUT.remoteCardPlay.fadeDuration,
        ease: 'power1.in'
      })

    await Promise.race([
      cancelled,
      new Promise<void>((resolve) => {
        timeline.eventCallback('onComplete', resolve)
        timeline.eventCallback('onInterrupt', resolve)
      })
    ])
    if (sequence !== this.sequence || card.destroyed) return
    this.cancelPending = null
    card.removeFromParent()
    card.destroy({ children: true })
  }

  override dispose(): void {
    this.sequence += 1
    this.clearActiveCard()
    super.dispose()
  }

  private clearActiveCard(): void {
    this.cancelPending?.()
    this.cancelPending = null
    this.killAnimations()
    for (const child of this.removeChildren()) child.destroy({ children: true })
  }

  private async createCard(
    definition: CardDefinition,
    snapshot?: OpeningCard,
    concealSecret = isRemoteSecret(definition)
  ): Promise<Container> {
    if (concealSecret) {
      const container = new Container()
      const card = new Sprite(this.secretTexture)
      card.scale.set(MATCH_HISTORY_LAYOUT.preview.historyCard.scale)
      container.addChild(card)
      return container
    }

    const artwork = await this.resolver.loadArtwork(definition.id)
    return CardView.create(definition, this.resolver, {
      animatePremiumArtwork: true,
      artwork: artwork ?? undefined,
      snapshot: snapshot
        ? { ...snapshot, rulesText: cthunCardRulesText(snapshot, definition.rulesText) }
        : undefined
    })
  }
}
