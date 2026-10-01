import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js'
import {
  CARD_CATALOG,
  type ArenaRewardReceipt,
  type ArenaReward
} from '../../game-rules'
import { Actor } from '../lifecycle/actor'
import { Button } from '../controls/button'
import { CardView } from './card-view'
import { CardAssetResolver } from '../assets/card-asset-resolver'
import type { ArenaAssets } from '../assets'
import { applyAnchoredPlacement, applyPlacement } from '../layout'
import { GhostAura, GHOST_DISAPPEARANCE_SECONDS } from '../effects/ghost-aura'
import {
  ARENA_REWARDS_LAYOUT as LAYOUT,
  arenaRewardPosition
} from './reward-prizes-layout'

export class ArenaRewardsView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly confirm: Button
  private readonly confirmAura: GhostAura
  private readonly shade: Graphics
  private readonly slots: Container[] = []
  private readonly opened = new Set<number>()
  private closed = false
  private acknowledging = false

  constructor(
    receipt: ArenaRewardReceipt,
    private readonly assets: ArenaAssets,
    private readonly onConfirm: () => Promise<void>,
    private readonly onError: (message: string, error: unknown) => void,
    private readonly labelPrefix = 'arena',
    private readonly onDismiss?: () => Promise<void> | void,
    private readonly onBackdropFade?: (duration: number) => Promise<void> | void
  ) {
    super()
    this.label = `${labelPrefix}.rewards`
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.on('pointertap', (event) => event.stopPropagation())
    this.on('wheel', (event) => event.stopPropagation())
    this.shade = new Graphics()
      .rect(0, 0, 1920, 1080)
      .fill({ color: 0x000000, alpha: LAYOUT.overlayAlpha })
    this.shade.label = `${labelPrefix}.reward-overlay`
    this.shade.eventMode = 'none'
    this.addChild(this.shade)
    receipt.prizes.forEach((prize, index) =>
      this.createBox(prize, index, receipt.prizes.length)
    )
    this.confirm = new Button(assets.confirmReward, {
      onClick: () => this.acknowledge()
    })
    this.confirm.label = `${labelPrefix}.reward-confirm`
    applyPlacement(this.confirm, LAYOUT.confirm)
    this.confirm.setBaseY(LAYOUT.confirm.position.y)
    this.addChild(this.confirm)
    this.confirmAura = new GhostAura(this.confirm, {
      silhouette: this.confirm.sprite,
      noise: assets.burnNoise,
      dissolve: assets.ghostDissolve,
      spotlight: assets.ghostSpotlight
    })
    this.confirmAura.setEnabled(false)
    this.confirm.setEnabled(false)
    if (receipt.prizes.length === 0) this.showConfirm()
  }

  private createBox(prize: ArenaReward, index: number, count: number): void {
    const root = new Container()
    root.label = `${this.labelPrefix}.reward-slot.${index}`
    const position = arenaRewardPosition(index, count)
    root.position.set(position.x, position.y)
    const box = new Sprite(this.assets.rewardBox)
    box.label = `${this.labelPrefix}.reward-box.${index}`
    applyAnchoredPlacement(box, LAYOUT.box)
    box.eventMode = 'static'
    box.cursor = 'pointer'
    box.on('pointertap', (event) => {
      if (event.button !== 0) return
      if (box.eventMode === 'none' || this.closed) return
      box.eventMode = 'none'
      void this.reveal(root, box, prize, index)
    })
    root.addChild(box)
    this.addChild(root)
    this.slots.push(root)
    root.scale.set(0.1)
    this.tweenTo(root.scale, {
      x: 1,
      y: 1,
      duration: LAYOUT.entryDuration,
      delay: index * LAYOUT.stagger,
      ease: 'power2.out'
    })
  }

  private async reveal(
    root: Container,
    box: Sprite,
    prize: ArenaReward,
    index: number
  ): Promise<void> {
    let view: Container
    if (prize.kind === 'dust') {
      view = new Container()
      const dust = new Sprite(this.assets.rewardDust)
      dust.label = `${this.labelPrefix}.reward-dust.${index}`
      applyAnchoredPlacement(dust, LAYOUT.dust)
      const amount = this.text(String(prize.amount), 52)
      amount.label = `${this.labelPrefix}.reward-amount.${index}`
      applyAnchoredPlacement(amount, LAYOUT.amount)
      view.addChild(dust, amount)
    } else {
      const card = CARD_CATALOG.require(prize.cardId)
      try {
        const artwork = await this.resolver.loadArtwork(card.id)
        if (this.closed) return
        const rendered = await CardView.create(card, this.resolver, {
          artwork,
          premium: true
        })
        if (this.closed) {
          rendered.destroy({ children: true })
          return
        }
        rendered.scale.set(LAYOUT.cardScale)
        rendered.pivot.set(rendered.plan.width / 2, rendered.renderedHeight / 2)
        view = rendered
      } catch (error) {
        if (this.closed) return
        view = this.text(`Premium\n${card.name}`, 25)
        this.onError('Failed to load prize artwork. The prize is already saved.', error)
      }
    }
    if (this.closed) {
      view.destroy({ children: true })
      return
    }
    view.label = `${this.labelPrefix}.reward-prize.${index}`
    view.eventMode = 'none'
    view.alpha = 0
    root.addChild(view)
    this.tweenTo(box, { alpha: 0, duration: LAYOUT.revealDuration })
    this.tweenTo(view, { alpha: 1, duration: LAYOUT.revealDuration })
    this.opened.add(index)
    if (this.opened.size === this.slots.length) this.showConfirm()
  }

  private showConfirm(): void {
    if (this.closed || this.acknowledging) return
    this.confirmAura.setEnabled(true)
    this.confirm.setEnabled(true)
  }

  private text(value: string, fontSize: number): Text {
    const text = new Text({
      text: value,
      style: {
        fontFamily: 'Belwe',
        fontSize,
        fill: 0xffffff,
        fontWeight: '700',
        align: 'center',
        stroke: { color: 0x000000, width: 4 },
        wordWrap: true,
        wordWrapWidth: 280
      }
    })
    text.anchor.set(0.5)
    return text
  }

  private async acknowledge(): Promise<void> {
    if (this.acknowledging || this.closed || this.opened.size !== this.slots.length)
      return
    this.acknowledging = true
    this.confirm.setEnabled(false)
    let saved = false
    try {
      await this.onConfirm()
      saved = true
      if (this.closed) return
      await this.exitRewards()
      if (!this.closed) await this.onDismiss?.()
    } catch (error) {
      if (!this.closed)
        this.onError(
          saved
            ? 'Rewards were saved, but the reward screen could not close.'
            : 'Failed to acknowledge rewards. Please try Confirm again.',
          error
        )
    } finally {
      if (!this.closed) {
        this.acknowledging = false
        if (!saved && this.opened.size === this.slots.length) this.showConfirm()
      }
    }
  }

  private async exitRewards(): Promise<void> {
    this.confirmAura.disappear(this.parent)
    for (const slot of this.slots) this.killTweensOf(slot.scale)
    const shrink =
      this.slots.length === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            this.tweenTo(
              this.slots.map((slot) => slot.scale),
              {
                x: 0,
                y: 0,
                duration: LAYOUT.shrinkDuration,
                ease: 'power2.in',
                onComplete: resolve,
                onInterrupt: resolve
              }
            )
          })
    await shrink
    if (this.closed) return
    await Promise.all([
      new Promise<void>((resolve) => {
        this.tweenTo(this.shade, {
          alpha: 0,
          duration: LAYOUT.backdropFadeDuration,
          ease: 'power2.out',
          onComplete: resolve,
          onInterrupt: resolve
        })
      }),
      this.onBackdropFade?.(LAYOUT.backdropFadeDuration)
    ])
    if (this.closed) return
    await new Promise<void>((resolve) => {
      this.tweenTo(
        {},
        {
          duration: Math.max(
            0,
            GHOST_DISAPPEARANCE_SECONDS -
              LAYOUT.shrinkDuration -
              LAYOUT.backdropFadeDuration
          ),
          onComplete: resolve,
          onInterrupt: resolve
        }
      )
    })
  }

  override dispose(): void {
    this.closed = true
    this.confirmAura.dispose()
    this.confirm.dispose()
    super.dispose()
  }
}
