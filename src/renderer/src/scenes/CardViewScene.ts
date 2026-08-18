import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import {
  formatCardSetName,
  type CardDefinition
} from '../../../../card-lab/card-catalog'
import { CardAssetResolver } from '../../../../card-lab/card-asset-manifest'
import { CardView } from '../../../../card-lab/card-view'
import { GAME_HEIGHT, GAME_WIDTH } from '../core/config'
import { CardPreviewParallax, resolveParallaxTarget } from './cardPreviewParallax'
import { Scene } from './Scene'

export interface CardPreviewSourceBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CardViewSceneOptions {
  readonly card: CardDefinition
  readonly sourceBounds: CardPreviewSourceBounds
  readonly resolver?: CardAssetResolver
}

export interface CardDetailRow {
  readonly label: string
  readonly value: string
}

const COLORS = {
  backdrop: 0x080b12,
  panel: 0x161d2b,
  panelBorder: 0xb08a4e,
  heading: 0xf1e4c8,
  label: 0xb8a781,
  value: 0xffffff,
  effect: 0xe6d9bd,
  muted: 0x8f9bb0
} as const

const PREVIEW = {
  cardCenter: { x: 1080, y: GAME_HEIGHT / 2 },
  pointerRange: { x: 480, y: 440 },
  maxScale: 0.86,
  panel: { x: 150, y: 128, width: 500, height: 824 },
  panelPadding: 28,
  panelHeadingY: 26,
  rowStartY: 92,
  rowStep: 42,
  effectHeadingGap: 24,
  animationDuration: 0.28
} as const

// The preview effect is intentionally controlled here so it can be disabled
// without touching the shared CardView renderer or collection interactions.
const CARD_PREVIEW_PARALLAX_ENABLED = true

const DETAIL_LABEL_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 18,
  fill: COLORS.label
} as const

const DETAIL_VALUE_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 21,
  fill: COLORS.value,
  wordWrap: true,
  breakWords: true
} as const

const EFFECT_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 22,
  fill: COLORS.effect,
  wordWrap: true,
  breakWords: true,
  lineHeight: 27
} as const

/** Builds the metadata rows shown beside the enlarged card. */
export function cardDetailRows(card: CardDefinition): readonly CardDetailRow[] {
  const rows: CardDetailRow[] = [
    { label: 'Name', value: card.name },
    { label: 'Type', value: card.type },
    { label: 'Mana', value: String(card.cost) },
    { label: 'Class', value: card.cardClass },
    { label: 'Collection', value: formatCardSetName(card.set) },
    { label: 'Rarity', value: card.rarity }
  ]

  if (card.subtype) rows.push({ label: 'Subtype', value: card.subtype })
  if (card.spellSchool) rows.push({ label: 'School', value: card.spellSchool })
  if ((card.type === 'Minion' || card.type === 'Weapon') && card.attack !== null) {
    rows.push({ label: 'Attack', value: String(card.attack) })
  }
  if (card.type === 'Weapon' && card.durability !== null) {
    rows.push({ label: 'Durability', value: String(card.durability) })
  } else if (card.type === 'Hero' && card.armor !== null) {
    rows.push({ label: 'Armor', value: String(card.armor) })
  } else if (card.type === 'Minion' && card.health !== null) {
    rows.push({ label: 'Health', value: String(card.health) })
  }

  return rows
}

/** Contextual enlarged card preview opened from the Collection scene. */
export class CardViewScene extends Scene {
  private readonly card: CardDefinition
  private readonly sourceBounds: CardPreviewSourceBounds
  private readonly resolver: CardAssetResolver

  private backdrop!: Graphics
  private detailsPanel!: Container
  private cardMotion!: Container
  private cardView!: CardView
  private parallax: CardPreviewParallax | null = null
  private activeTimeline: { kill: () => void } | null = null
  private closing = false

  constructor(options: CardViewSceneOptions) {
    super()
    this.card = options.card
    this.sourceBounds = options.sourceBounds
    this.resolver = options.resolver ?? new CardAssetResolver()
  }

  async init(): Promise<void> {
    await this.waitForFonts()

    this.backdrop = new Graphics()
      .rect(0, 0, GAME_WIDTH, GAME_HEIGHT)
      .fill({ color: COLORS.backdrop, alpha: 0.78 })
    this.backdrop.alpha = 0
    this.backdrop.eventMode = 'static'
    this.backdrop.cursor = 'default'
    this.backdrop.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.backdrop.on('pointertap', this.handleBackdropTap)
    this.root.addChild(this.backdrop)

    this.detailsPanel = this.createDetailsPanel()
    this.detailsPanel.alpha = 0
    this.root.addChild(this.detailsPanel)

    const artwork = await this.resolver.loadArtwork(this.card.id)
    this.cardView = await CardView.create(this.card, this.resolver, { artwork })
    this.cardView.eventMode = 'static'

    this.cardMotion = new Container()
    this.cardMotion.addChild(this.cardView)
    if (CARD_PREVIEW_PARALLAX_ENABLED) {
      this.parallax = new CardPreviewParallax(this.cardView)
      this.backdrop.on('globalpointermove', this.handlePointerMove)
    }
    this.positionAtSource()
    this.root.addChild(this.cardMotion)
  }

  update(deltaMS: number): void {
    this.parallax?.update(deltaMS)
  }

  protected onEnter(): void {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('blur', this.handlePointerExit)
    this.appInstance.canvas.addEventListener('pointerleave', this.handlePointerExit)
    this.playOpenAnimation()
  }

  protected onExit(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('blur', this.handlePointerExit)
    this.appInstance.canvas.removeEventListener('pointerleave', this.handlePointerExit)
    this.activeTimeline?.kill()
    this.activeTimeline = null
    this.killTweensOf(this.backdrop)
    this.killTweensOf(this.detailsPanel)
    this.killTweensOf(this.cardMotion)
    this.killTweensOf(this.cardMotion.scale)
    this.parallax?.destroy()
    this.parallax = null
  }

  private async waitForFonts(): Promise<void> {
    if (!document.fonts) return

    await Promise.all([
      document.fonts.load('28px Belwe'),
      document.fonts.load('400 22px "Franklin Gothic Condensed"'),
      document.fonts.load('700 22px "Franklin Gothic Condensed"')
    ])
  }

  private createDetailsPanel(): Container {
    const panel = new Container()
    panel.position.set(PREVIEW.panel.x, PREVIEW.panel.y)

    const background = new Graphics()
      .roundRect(0, 0, PREVIEW.panel.width, PREVIEW.panel.height, 14)
      .fill({ color: COLORS.panel, alpha: 0.96 })
    background
      .roundRect(0, 0, PREVIEW.panel.width, PREVIEW.panel.height, 14)
      .stroke({ color: COLORS.panelBorder, width: 2, alpha: 0.9 })
    background.eventMode = 'none'
    panel.addChild(background)
    panel.eventMode = 'static'
    panel.hitArea = new Rectangle(0, 0, PREVIEW.panel.width, PREVIEW.panel.height)
    panel.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
    })

    const heading = new Text({
      text: 'CARD DETAILS',
      style: {
        fontFamily: 'Belwe',
        fontSize: 28,
        fill: COLORS.heading
      }
    })
    heading.position.set(PREVIEW.panelPadding, PREVIEW.panelHeadingY)
    panel.addChild(heading)

    const rows = cardDetailRows(this.card)
    for (const [index, row] of rows.entries()) {
      const y = PREVIEW.rowStartY + index * PREVIEW.rowStep
      const label = new Text({
        text: row.label.toUpperCase(),
        style: DETAIL_LABEL_STYLE
      })
      label.position.set(PREVIEW.panelPadding, y)
      label.anchor.set(0, 0.5)
      label.eventMode = 'none'
      panel.addChild(label)

      const value = new Text({
        text: row.value,
        style: {
          ...DETAIL_VALUE_STYLE,
          wordWrapWidth: PREVIEW.panel.width - PREVIEW.panelPadding * 2 - 140
        }
      })
      value.position.set(PREVIEW.panel.width - PREVIEW.panelPadding, y)
      value.anchor.set(1, 0.5)
      value.eventMode = 'none'
      panel.addChild(value)
    }

    const effectY =
      PREVIEW.rowStartY + rows.length * PREVIEW.rowStep + PREVIEW.effectHeadingGap
    const effectHeading = new Text({
      text: 'EFFECT',
      style: DETAIL_LABEL_STYLE
    })
    effectHeading.position.set(PREVIEW.panelPadding, effectY)
    effectHeading.eventMode = 'none'
    panel.addChild(effectHeading)

    const effect = new Text({
      text: this.card.effect || 'No effect',
      style: {
        ...EFFECT_STYLE,
        wordWrapWidth: PREVIEW.panel.width - PREVIEW.panelPadding * 2
      }
    })
    effect.position.set(PREVIEW.panelPadding, effectY + 28)
    effect.eventMode = 'none'
    panel.addChild(effect)

    const hint = new Text({
      text: 'Click outside the card or press Escape to close',
      style: {
        fontFamily: 'Franklin Gothic Condensed',
        fontSize: 16,
        fill: COLORS.muted
      }
    })
    hint.position.set(PREVIEW.panelPadding, PREVIEW.panel.height - 30)
    hint.anchor.set(0, 0.5)
    hint.eventMode = 'none'
    panel.addChild(hint)

    return panel
  }

  private positionAtSource(): void {
    const sourceScale = Math.min(
      this.sourceBounds.width / this.cardView.plan.width,
      this.sourceBounds.height / this.cardView.renderedHeight
    )
    this.cardMotion.scale.set(Math.max(0.001, sourceScale))
    this.cardMotion.position.set(this.sourceBounds.x, this.sourceBounds.y)
  }

  private positionAtPreview(): { scale: number; x: number; y: number } {
    const scale = Math.min(
      PREVIEW.maxScale,
      (GAME_HEIGHT - 80) / this.cardView.renderedHeight,
      (GAME_WIDTH - 760) / this.cardView.plan.width
    )
    return {
      scale,
      x: PREVIEW.cardCenter.x - (this.cardView.plan.width * scale) / 2,
      y: PREVIEW.cardCenter.y - (this.cardView.renderedHeight * scale) / 2
    }
  }

  private playOpenAnimation(): void {
    const target = this.positionAtPreview()
    this.activeTimeline?.kill()
    const timeline = this.timeline()
    this.activeTimeline = timeline
    timeline.to(
      this.backdrop,
      { alpha: 1, duration: PREVIEW.animationDuration, ease: 'power2.out' },
      0
    )
    timeline.to(
      this.cardMotion,
      {
        x: target.x,
        y: target.y,
        duration: PREVIEW.animationDuration,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      this.cardMotion.scale,
      {
        x: target.scale,
        y: target.scale,
        duration: PREVIEW.animationDuration,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      this.detailsPanel,
      { alpha: 1, duration: PREVIEW.animationDuration, ease: 'power2.out' },
      0.08
    )
  }

  private readonly handleBackdropTap = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    void this.close()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    void this.close()
  }

  private readonly handlePointerMove = (event: FederatedPointerEvent): void => {
    if (this.closing || !this.parallax) return

    const pointer = this.root.toLocal(event.global)
    this.parallax.setTarget(
      resolveParallaxTarget(pointer, PREVIEW.cardCenter, PREVIEW.pointerRange)
    )
  }

  private readonly handlePointerExit = (): void => {
    this.parallax?.release()
  }

  private async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.parallax?.release()

    this.activeTimeline?.kill()
    const timeline = this.timeline()
    this.activeTimeline = timeline
    timeline.to(
      this.backdrop,
      { alpha: 0, duration: PREVIEW.animationDuration, ease: 'power2.in' },
      0
    )
    timeline.to(
      this.detailsPanel,
      { alpha: 0, duration: PREVIEW.animationDuration, ease: 'power2.in' },
      0
    )
    timeline.to(
      this.cardMotion,
      {
        x: this.sourceBounds.x,
        y: this.sourceBounds.y,
        duration: PREVIEW.animationDuration,
        ease: 'power2.in'
      },
      0
    )
    const sourceScale = Math.min(
      this.sourceBounds.width / this.cardView.plan.width,
      this.sourceBounds.height / this.cardView.renderedHeight
    )
    timeline.to(
      this.cardMotion.scale,
      {
        x: Math.max(0.001, sourceScale),
        y: Math.max(0.001, sourceScale),
        duration: PREVIEW.animationDuration,
        ease: 'power2.in',
        onComplete: () => {
          this.activeTimeline = null
          void this.sceneManager.pop()
        }
      },
      0
    )
  }
}
