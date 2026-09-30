import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js'
import {
  CARD_CATALOG,
  type ArenaRewardReceipt,
  type ArenaReward
} from '../../game-rules'
import { Actor } from '../../visual-components/lifecycle/actor'
import { Button } from '../../visual-components/controls/button'
import { CardView } from '../../visual-components/cards/card-view'
import { CardAssetResolver } from '../../visual-components/assets/card-asset-resolver'
import type { ArenaAssets } from '../../visual-components/assets'
import { applyAnchoredPlacement, applyPlacement } from '../../visual-components/layout'
import {
  ARENA_REWARDS_LAYOUT as LAYOUT,
  arenaRewardPosition
} from './arena-rewards-layout'

export class ArenaRewardsView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly confirm: Button
  private closed = false
  private acknowledging = false

  constructor(
    receipt: ArenaRewardReceipt,
    private readonly assets: ArenaAssets,
    private readonly onConfirm: () => Promise<void>,
    private readonly onError: (message: string, error: unknown) => void
  ) {
    super()
    this.label = 'arena.rewards'
    this.eventMode = 'static'
    this.hitArea = new Rectangle(0, 0, 1920, 1080)
    this.on('pointertap', (event) => event.stopPropagation())
    this.on('wheel', (event) => event.stopPropagation())
    const shade = new Graphics()
      .rect(0, 0, 1920, 1080)
      .fill({ color: 0x000000, alpha: LAYOUT.overlayAlpha })
    shade.label = 'arena.reward-overlay'
    shade.eventMode = 'none'
    this.addChild(shade)
    receipt.prizes.forEach((prize, index) =>
      this.createBox(prize, index, receipt.prizes.length)
    )
    this.confirm = new Button(assets.confirmReward, {
      onClick: () => this.acknowledge()
    })
    this.confirm.label = 'arena.reward-confirm'
    applyPlacement(this.confirm, LAYOUT.confirm)
    this.confirm.setBaseY(LAYOUT.confirm.position.y)
    this.addChild(this.confirm)
  }

  private createBox(prize: ArenaReward, index: number, count: number): void {
    const root = new Container()
    root.label = `arena.reward-slot.${index}`
    const position = arenaRewardPosition(index, count)
    root.position.set(position.x, position.y)
    const box = new Sprite(this.assets.rewardBox)
    box.label = `arena.reward-box.${index}`
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
      dust.label = `arena.reward-dust.${index}`
      applyAnchoredPlacement(dust, LAYOUT.dust)
      const amount = this.text(String(prize.amount), 52)
      amount.label = `arena.reward-amount.${index}`
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
        this.onError(
          'Failed to load Arena prize artwork. The prize is already saved.',
          error
        )
      }
    }
    if (this.closed) {
      view.destroy({ children: true })
      return
    }
    view.label = `arena.reward-prize.${index}`
    view.eventMode = 'none'
    view.alpha = 0
    root.addChild(view)
    this.tweenTo(box, { alpha: 0, duration: 0.2 })
    this.tweenTo(view, { alpha: 1, duration: 0.2 })
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
    if (this.acknowledging || this.closed) return
    this.acknowledging = true
    this.confirm.setEnabled(false)
    try {
      await this.onConfirm()
    } catch (error) {
      if (!this.closed)
        this.onError(
          'Failed to acknowledge Arena rewards. Please try Confirm again.',
          error
        )
    } finally {
      if (!this.closed) {
        this.acknowledging = false
        this.confirm.setEnabled(true)
      }
    }
  }

  override dispose(): void {
    this.closed = true
    this.confirm.dispose()
    super.dispose()
  }
}
