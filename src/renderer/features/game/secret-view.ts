import { Container, Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import { CARD_CATALOG } from '../../../game/content/cards'
import { AnimationScope } from '../../animation/animations'
import { CardView } from '../../rendering/cards/card-view'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { SECRET_LAYOUT } from './secret-layout'
import { SECRET_REVEAL_TIMING } from './game-presentation-timing'
import type { OpeningPlayerState } from '../../../game/match'

export type SecretPresentationSide = 'local' | 'remote'

/** Projects authoritative Secret counts as one facedown badge over each hero. */
export class SecretZoneView extends Container {
  private readonly badges: Record<SecretPresentationSide, Container>
  private readonly hoverOutlines = new Map<SecretPresentationSide, AnimatedOutline>()
  private readonly animations = new AnimationScope()

  constructor(
    private readonly texture: Texture,
    onLocalHover?: (hovered: boolean) => void
  ) {
    super()
    this.label = 'game.secrets'
    this.eventMode = 'passive'
    this.badges = {
      local: this.createBadge('local'),
      remote: this.createBadge('remote')
    }
    this.addChild(this.badges.local, this.badges.remote)
    const local = this.badges.local
    local.eventMode = 'static'
    const { width, height } = SECRET_LAYOUT.badges.local.size
    local.hitArea = new Rectangle(-width / 2, -height / 2, width, height)
    local.on('pointerover', () => onLocalHover?.(true))
    local.on('pointerout', () => onLocalHover?.(false))
  }

  sync(side: SecretPresentationSide, count: number): void {
    const nextCount = Math.max(0, count)
    const badge = this.badges[side]
    badge.visible = nextCount > 0
    const countLabel = badge.getChildByLabel(`game.secret.${side}.count`)
    if (countLabel instanceof Text) {
      countLabel.visible = nextCount > 0
      countLabel.text = String(nextCount)
    }
  }

  revealOrigin(
    side: SecretPresentationSide,
    target: Container
  ): { x: number; y: number } {
    return target.toLocal(this.badges[side].getGlobalPosition())
  }

  setPaired(side: SecretPresentationSide, paired: boolean): void {
    const badge = this.badges[side]
    const x =
      SECRET_LAYOUT.badges[side].position.x +
      (paired ? SECRET_LAYOUT.pairedBadgeOffset : 0)
    if (badge.x !== x)
      this.animations.timeline().to(badge, {
        x,
        duration: 0.18,
        ease: 'power2.out'
      })
  }

  setHoverAura(side: SecretPresentationSide, enabled: boolean): void {
    this.hoverOutlines.get(side)?.setEnabled(enabled)
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.animations.kill()
    for (const outline of this.hoverOutlines.values()) outline.dispose()
    super.destroy(options)
  }

  private createBadge(side: SecretPresentationSide): Container {
    const badge = new Container()
    applyPlacement(badge, SECRET_LAYOUT.badges[side])
    badge.label = `game.secret.${side}`
    badge.eventMode = 'none'
    badge.visible = false

    const marker = new Sprite(this.texture)
    marker.anchor.set(0.5)
    marker.eventMode = 'none'
    marker.label = `game.secret.${side}.icon`
    badge.addChild(marker)

    const hoverTarget = new Sprite(this.texture)
    hoverTarget.anchor.set(0.5)
    hoverTarget.eventMode = 'none'
    hoverTarget.visible = false
    hoverTarget.label = `game.secret.${side}.hover-outline-target`
    badge.addChildAt(hoverTarget, 0)
    const hoverOutline = new AnimatedOutline(hoverTarget, {
      palette: 'white',
      preset: 'board'
    })
    hoverOutline.setEnabled(false)
    this.hoverOutlines.set(side, hoverOutline)

    const count = new Text({
      text: '0',
      style: SECRET_LAYOUT.countTextStyle,
      anchor: 0.5
    })
    applyAnchoredPlacement(count, SECRET_LAYOUT.count)
    count.eventMode = 'none'
    count.label = `game.secret.${side}.count`
    badge.addChild(count)

    return badge
  }
}

/** Public Quest objective and progress, sharing the hero marker rail with Secrets. */
export class QuestZoneView extends Container {
  private readonly badges: Record<SecretPresentationSide, Container>
  private readonly hoverOutlines = new Map<SecretPresentationSide, AnimatedOutline>()
  private readonly animations = new AnimationScope()

  constructor(
    texture: Texture,
    onHover: (side: SecretPresentationSide, hovered: boolean) => void
  ) {
    super()
    this.label = 'game.quests'
    this.eventMode = 'passive'
    this.badges = {
      local: this.createBadge('local', texture, onHover),
      remote: this.createBadge('remote', texture, onHover)
    }
    this.addChild(this.badges.local, this.badges.remote)
  }

  sync(
    side: SecretPresentationSide,
    quest: OpeningPlayerState['quest'],
    paired: boolean
  ): void {
    const badge = this.badges[side]
    badge.visible = !!quest
    const count = badge.getChildByLabel(`game.quest.${side}.count`)
    if (count instanceof Text && quest) count.text = `${quest.progress}/${quest.target}`
    const x =
      SECRET_LAYOUT.badges[side].position.x -
      (paired ? SECRET_LAYOUT.pairedBadgeOffset : 0)
    if (badge.x !== x)
      this.animations.timeline().to(badge, {
        x,
        duration: 0.18,
        ease: 'power2.out'
      })
  }

  setHoverAura(side: SecretPresentationSide, enabled: boolean): void {
    this.hoverOutlines.get(side)?.setEnabled(enabled)
  }

  private createBadge(
    side: SecretPresentationSide,
    texture: Texture,
    onHover: (side: SecretPresentationSide, hovered: boolean) => void
  ): Container {
    const badge = new Container()
    applyPlacement(badge, SECRET_LAYOUT.badges[side])
    badge.label = `game.quest.${side}`
    badge.eventMode = 'static'
    badge.visible = false
    const { width, height } = SECRET_LAYOUT.badges[side].size
    badge.hitArea = new Rectangle(-width / 2, -height / 2, width, height)
    badge.on('pointerover', () => onHover(side, true))
    badge.on('pointerout', () => onHover(side, false))
    const marker = new Sprite(texture)
    marker.anchor.set(0.5)
    marker.label = `game.quest.${side}.icon`
    marker.eventMode = 'none'
    badge.addChild(marker)

    const hoverTarget = new Sprite(texture)
    hoverTarget.anchor.set(0.5)
    hoverTarget.eventMode = 'none'
    hoverTarget.visible = false
    hoverTarget.label = `game.quest.${side}.hover-outline-target`
    badge.addChildAt(hoverTarget, 0)
    const hoverOutline = new AnimatedOutline(hoverTarget, {
      palette: 'white',
      preset: 'board'
    })
    hoverOutline.setEnabled(false)
    this.hoverOutlines.set(side, hoverOutline)
    const count = new Text({
      text: '0/0',
      style: SECRET_LAYOUT.questProgressTextStyle,
      anchor: 0.5
    })
    applyAnchoredPlacement(count, SECRET_LAYOUT.count)
    count.label = `game.quest.${side}.count`
    count.eventMode = 'none'
    badge.addChild(count)
    return badge
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.animations.kill()
    for (const outline of this.hoverOutlines.values()) outline.dispose()
    super.destroy(options)
  }
}

/** Banner, badge consumption, then a card reveal that gates the Secret's effects. */
export class SecretRevealView extends Container {
  private readonly screen: Sprite
  private readonly animations = new AnimationScope()
  private readonly resolver = new CardAssetResolver()
  private completion: (() => void) | null = null
  private presentationSequence = 0
  private revealedCard: CardView | null = null

  constructor(texture: Texture) {
    super()
    this.label = 'game.secret-reveal'
    this.eventMode = 'none'
    this.visible = false
    this.screen = new Sprite(texture)
    applyAnchoredPlacement(this.screen, SECRET_LAYOUT.reveal)
    this.screen.label = 'game.secret-reveal.screen'
    this.screen.eventMode = 'none'
    this.addChild(this.screen)
  }

  present(
    cardId: string,
    origin: { x: number; y: number },
    onBannerComplete: () => void,
    premium = false,
    premiumSide: 'local' | 'remote' = 'local'
  ): Promise<void> {
    this.finish()
    const sequence = ++this.presentationSequence
    return new Promise((resolve, reject) => {
      // Install completion before loading so scene exit also cancels pending assets.
      this.completion = resolve
      void this.prepare(
        sequence,
        cardId,
        origin,
        onBannerComplete,
        premium,
        premiumSide
      ).catch((error: unknown) => {
        if (sequence !== this.presentationSequence || this.destroyed) return
        this.completion = null
        this.finish()
        reject(error)
      })
    })
  }

  private async prepare(
    sequence: number,
    cardId: string,
    origin: { x: number; y: number },
    onBannerComplete: () => void,
    premium: boolean,
    premiumSide: 'local' | 'remote'
  ): Promise<void> {
    const definition = CARD_CATALOG.get(cardId)
    if (!definition) {
      onBannerComplete()
      this.finish()
      return
    }
    const artwork = await this.resolver.loadArtwork(cardId)
    if (sequence !== this.presentationSequence || this.destroyed) return
    const card = await CardView.create(definition, this.resolver, {
      premium,
      premiumSide,
      animatePremiumArtwork: true,
      artwork: artwork ?? undefined
    })
    if (sequence !== this.presentationSequence || this.destroyed) {
      card.destroy({ children: true })
      return
    }
    card.label = 'game.secret-reveal.card'
    card.eventMode = 'none'
    const placement = SECRET_LAYOUT.revealCard
    applyPlacement(card, placement)
    card.pivot.set(
      placement.size.width * placement.anchor.x,
      placement.size.height * placement.anchor.y
    )
    this.revealedCard = card
    this.addChild(card)
    card.position.set(origin.x, origin.y)
    card.scale.set(SECRET_LAYOUT.revealMotion.cardStartScale)
    card.visible = false
    this.screen.visible = true
    this.screen.alpha = 0
    this.screen.scale.set(SECRET_LAYOUT.revealMotion.bannerStartScale)
    this.visible = true
    this.alpha = 1
    const timeline = this.animations.timeline()
    const timing = SECRET_REVEAL_TIMING
    const cardStart = timing.bannerGrow + timing.bannerHold + timing.bannerFade
    timeline.to(
      this.screen,
      { alpha: 1, duration: timing.bannerGrow, ease: 'power2.out' },
      0
    )
    timeline.to(
      this.screen.scale,
      { x: 1, y: 1, duration: timing.bannerGrow, ease: 'power2.out' },
      0
    )
    timeline.to(
      this.screen,
      { alpha: 0, duration: timing.bannerFade, ease: 'power2.in' },
      timing.bannerGrow + timing.bannerHold
    )
    timeline.call(
      () => {
        this.screen.visible = false
        onBannerComplete()
        card.visible = true
      },
      [],
      cardStart
    )
    timeline.to(
      card,
      {
        x: placement.position.x,
        y: placement.position.y,
        duration: timing.cardGrow,
        ease: 'power2.out'
      },
      cardStart
    )
    timeline.to(
      card.scale,
      {
        x: placement.scale!.x,
        y: placement.scale!.y,
        duration: timing.cardGrow,
        ease: 'power2.out'
      },
      cardStart
    )
    timeline.to(card, { alpha: 0, duration: timing.cardFade, ease: 'power2.in' })
    timeline.eventCallback('onComplete', () => this.finish())
  }

  private finish(): void {
    this.animations.kill()
    this.visible = false
    this.revealedCard?.destroy({ children: true })
    this.revealedCard = null
    const complete = this.completion
    this.completion = null
    complete?.()
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.presentationSequence++
    this.finish()
    super.destroy(options)
  }
}
