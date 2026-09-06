import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import { CARD_CATALOG } from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type {
  CardBurnedEvent,
  HistoryActionResolvedEvent,
  HistoryActionOutcome
} from '../../../game/match'
import { CardView } from '../../rendering/cards/card-view'
import { HeroPowerCardView } from '../../rendering/hero-powers/hero-power-presentation'
import { cardCostColor } from '../../rendering/cards/card-cost-presentation'
import { DamageIndicatorView } from './damage-indicator-view'
import { Actor } from '../../ui/components/actor'
import type { DeckPresentationAssets, HeroPowerAssetKey } from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { MATCH_HISTORY_LAYOUT } from './match-history-layout'
import {
  MatchHistoryModel,
  type MatchHistoryActionEntry,
  type MatchHistoryEntry,
  type MatchHistoryTarget
} from './match-history-model'

export interface MatchHistoryTextures {
  readonly local: Texture
  readonly remote: Texture
  readonly arrow: Texture
  readonly burnCard: Texture
  readonly burnThumb: Texture
  readonly damageIndicator: Texture
  readonly willDie: Texture
  readonly secretCard: Texture
  readonly secretThumb: Texture
  readonly fatigueCard: Texture
  readonly fatigueThumb: Texture
  readonly cardBack: Texture
  readonly heroFrames: DeckPresentationAssets
  readonly heroPowers: Record<HeroPowerAssetKey, Texture>
  readonly heroPowerCardFrame: Texture
}

interface HistoryRailItem {
  readonly entry: MatchHistoryEntry
  readonly container: Container
}

export function historySourceTitle(
  action: HistoryActionResolvedEvent['action']
): string | null {
  if (action === 'hero-power') return 'Hero Power'
  if (action === 'trigger') return 'Triggered Effect'
  if (action === 'combat') return null
  return 'Hidden Action'
}

export function historyOutcomeText(
  outcomes: readonly HistoryActionOutcome[]
): string | null {
  const labels = outcomes.flatMap((outcome) => {
    if (
      outcome.kind === 'damage' ||
      outcome.kind === 'draw' ||
      outcome.kind === 'create-hand'
    )
      return []
    if (outcome.kind === 'buff') return ['BUFF']
    if (outcome.kind === 'summon-board') return ['SUMMON']
    if (outcome.kind === 'freeze') return ['FROZEN']
    return [outcome.kind.toUpperCase()]
  })
  return labels.length > 0 ? labels.join(' / ') : null
}

/** Hover-driven action rail, kept outside the desaturated board layer. */
export class MatchHistoryView extends Actor {
  private readonly model: MatchHistoryModel
  private readonly rail = new Container()
  private readonly preview = new Container()
  private readonly resolver = new CardAssetResolver()
  private activeId: number | null = null
  private previewSequence = 0

  constructor(
    private readonly textures: MatchHistoryTextures,
    private readonly localParticipantId: string,
    private readonly setBoardDesaturated: (active: boolean) => void
  ) {
    super()
    this.model = new MatchHistoryModel(
      localParticipantId,
      MATCH_HISTORY_LAYOUT.rail.capacity
    )
    this.label = 'game.history'
    this.eventMode = 'passive'
    this.rail.label = 'game.history.rail'
    this.preview.label = 'game.history.preview'
    this.preview.eventMode = 'none'
    this.addChild(this.rail, this.preview)
  }

  record(event: HistoryActionResolvedEvent): void {
    this.model.record(event)
    this.renderRail()
  }

  recordBurn(event: CardBurnedEvent): void {
    this.model.recordBurn(event)
    this.renderRail()
  }

  private renderRail(): void {
    const old = this.rail.removeChildren()
    for (const child of old) child.destroy({ children: true })
    for (const [index, entry] of this.model.all().entries()) {
      const item = this.createRailItem(entry, index)
      this.rail.addChild(item.container)
    }
  }

  private createRailItem(entry: MatchHistoryEntry, index: number): HistoryRailItem {
    const container = new Container()
    container.label = `game.history.entry-${entry.id}`
    applyPlacement(container, {
      ...MATCH_HISTORY_LAYOUT.rail.frame,
      position: {
        x: MATCH_HISTORY_LAYOUT.rail.frame.position.x,
        y:
          MATCH_HISTORY_LAYOUT.rail.frame.position.y +
          index * MATCH_HISTORY_LAYOUT.rail.gap
      }
    })
    container.eventMode = 'static'
    container.hitArea = new Rectangle(0, 0, 75, 75)
    container.cursor = 'pointer'

    const artwork = new Sprite()
    artwork.label = `game.history.artwork-${entry.id}`
    artwork.position.set(
      MATCH_HISTORY_LAYOUT.rail.artworkInset,
      MATCH_HISTORY_LAYOUT.rail.artworkInset
    )
    const mask = new Graphics()
      .roundRect(
        0,
        0,
        MATCH_HISTORY_LAYOUT.rail.artworkSize,
        MATCH_HISTORY_LAYOUT.rail.artworkSize,
        5
      )
      .fill({ color: 0xffffff })
    mask.label = `game.history.mask-${entry.id}`
    mask.position.set(
      MATCH_HISTORY_LAYOUT.rail.artworkInset,
      MATCH_HISTORY_LAYOUT.rail.artworkInset
    )
    artwork.mask = mask
    container.addChild(artwork, mask)
    if (entry.kind === 'burn') this.showThumbnail(artwork, this.textures.burnThumb)
    else if (entry.action === 'fatigue')
      this.showThumbnail(artwork, this.textures.fatigueThumb)
    else if (entry.action === 'hero-power' && entry.source.heroPowerId)
      this.showThumbnail(artwork, this.heroPowerTexture(entry.source.heroPowerId))
    else if (this.isConcealedSecretEntry(entry))
      this.showThumbnail(artwork, this.textures.secretThumb)
    else if (entry.source.cardId) void this.loadThumbnail(artwork, entry.source.cardId)
    else container.addChild(this.createUnknownThumbnail())

    const frame = new Sprite(
      entry.participantId === this.localParticipantId
        ? this.textures.local
        : this.textures.remote
    )
    frame.label = `game.history.frame-${entry.id}`
    container.addChild(frame)
    container.on('pointerenter', () => void this.open(entry, index))
    container.on('pointerleave', () => this.close(entry.id))
    return { entry, container }
  }

  private async loadThumbnail(sprite: Sprite, cardId: string): Promise<void> {
    const texture = await this.resolver.loadArtwork(cardId)
    if (!texture || sprite.destroyed) return
    const size = MATCH_HISTORY_LAYOUT.rail.artworkSize
    const scale = Math.max(size / texture.width, size / texture.height)
    sprite.texture = texture
    sprite.scale.set(scale)
    sprite.position.set(
      MATCH_HISTORY_LAYOUT.rail.artworkInset + (size - texture.width * scale) / 2,
      MATCH_HISTORY_LAYOUT.rail.artworkInset + (size - texture.height * scale) / 2
    )
  }

  private showThumbnail(sprite: Sprite, texture: Texture): void {
    const size = MATCH_HISTORY_LAYOUT.rail.artworkSize
    const scale = Math.max(size / texture.width, size / texture.height)
    sprite.texture = texture
    sprite.scale.set(scale)
    sprite.position.set(
      MATCH_HISTORY_LAYOUT.rail.artworkInset + (size - texture.width * scale) / 2,
      MATCH_HISTORY_LAYOUT.rail.artworkInset + (size - texture.height * scale) / 2
    )
  }

  private createUnknownThumbnail(): Container {
    const placeholder = new Container()
    placeholder.label = 'game.history.unknown-thumbnail'
    placeholder.position.set(
      MATCH_HISTORY_LAYOUT.rail.artworkInset,
      MATCH_HISTORY_LAYOUT.rail.artworkInset
    )
    const background = new Graphics()
      .roundRect(
        0,
        0,
        MATCH_HISTORY_LAYOUT.rail.artworkSize,
        MATCH_HISTORY_LAYOUT.rail.artworkSize,
        5
      )
      .fill({ color: 0x17131a })
    background.label = 'game.history.unknown-thumbnail-background'
    const label = new Text({
      text: '?',
      style: { fontFamily: 'Belwe', fontSize: 42, fill: 0xe7d9ab },
      anchor: 0.5
    })
    label.label = 'game.history.unknown-thumbnail-label'
    label.position.set(28, 30)
    placeholder.addChild(background, label)
    return placeholder
  }

  private async open(entry: MatchHistoryEntry, railIndex: number): Promise<void> {
    this.activeId = entry.id
    const sequence = ++this.previewSequence
    this.setBoardDesaturated(true)
    this.preview.removeChildren().forEach((child) => child.destroy({ children: true }))
    if (entry.kind === 'burn') {
      this.preview.addChild(this.createBurnSource(railIndex))
      void this.addBurnedCardPreview(entry, sequence)
      return
    }
    if (entry.action === 'fatigue') {
      this.preview.addChild(this.createFatigueSource(entry, railIndex))
    } else if (entry.action === 'hero-power' && entry.source.heroPowerId) {
      this.preview.addChild(
        this.createHeroPowerSource(entry.source.heroPowerId, entry.source.currentCost)
      )
    } else if (this.isConcealedSecretEntry(entry)) {
      this.preview.addChild(
        this.createHistoryCard(
          this.textures.secretCard,
          'game.history.source-secret',
          railIndex
        )
      )
    } else if (entry.source.cardId) {
      const definition = CARD_CATALOG.require(entry.source.cardId)
      const artwork = await this.resolver.loadArtwork(entry.source.cardId)
      if (this.activeId !== entry.id || sequence !== this.previewSequence) return
      const source = await CardView.create(definition, this.resolver, {
        artwork: artwork ?? undefined
      })
      if (this.activeId !== entry.id || sequence !== this.previewSequence) {
        source.destroy({ children: true })
        return
      }
      source.label = 'game.history.source-card'
      source.eventMode = 'none'
      applyPlacement(source, this.sourcePlacement())
      this.preview.addChild(source)
    } else if (entry.source.kind === 'hero' && entry.source.heroId) {
      this.preview.addChild(this.createHeroSource(entry.source.heroId))
    } else {
      this.preview.addChild(this.createFallbackSource(entry))
    }
    if (entry.action !== 'fatigue') this.addOutcomePreviews(entry, sequence)
  }

  private close(id: number): void {
    if (this.activeId !== id) return
    this.activeId = null
    this.previewSequence += 1
    this.preview.removeChildren().forEach((child) => child.destroy({ children: true }))
    this.setBoardDesaturated(false)
  }

  private sourcePlacement() {
    return MATCH_HISTORY_LAYOUT.preview.source
  }

  private isConcealedSecretEntry(entry: MatchHistoryActionEntry): boolean {
    return (
      entry.action === 'card' &&
      entry.participantId !== this.localParticipantId &&
      entry.source.kind === 'card' &&
      entry.source.concealedAs === 'secret'
    )
  }

  private createHistoryCard(
    texture: Texture,
    label: string,
    _railIndex: number,
    scale = MATCH_HISTORY_LAYOUT.preview.historyCard.scale
  ): Container {
    const container = new Container()
    container.label = label
    applyPlacement(container, this.sourcePlacement())
    const card = new Sprite(texture)
    card.label = `${label}.artwork`
    card.scale.set(scale)
    container.addChild(card)
    return container
  }

  private createFatigueSource(
    entry: MatchHistoryActionEntry,
    _railIndex: number
  ): Container {
    const container = this.createHistoryCard(
      this.textures.fatigueCard,
      'game.history.source-fatigue',
      _railIndex
    )
    const amount = entry.outcomes.find((outcome) => outcome.kind === 'fatigue')?.amount
    if (amount === undefined) return container
    const indicator = new DamageIndicatorView(this.textures.damageIndicator, amount)
    indicator.label = 'game.history.fatigue-damage'
    indicator.position.set(
      MATCH_HISTORY_LAYOUT.preview.historyCard.fatigueDamage.x,
      MATCH_HISTORY_LAYOUT.preview.historyCard.fatigueDamage.y
    )
    indicator.scale.set(MATCH_HISTORY_LAYOUT.preview.historyCard.fatigueDamage.scale)
    container.addChild(indicator)
    return container
  }

  private createBurnSource(_railIndex: number): Container {
    const container = this.createHistoryCard(
      this.textures.burnCard,
      'game.history.source-burn',
      _railIndex,
      MATCH_HISTORY_LAYOUT.preview.historyCard.burnScale
    )
    return container
  }

  private async addBurnedCardPreview(
    entry: Extract<MatchHistoryEntry, { kind: 'burn' }>,
    sequence: number
  ): Promise<void> {
    const cardId = entry.card.cardId
    if (!cardId) return
    const position = {
      x: MATCH_HISTORY_LAYOUT.preview.targetGrid.origin.x,
      y: MATCH_HISTORY_LAYOUT.preview.targetGrid.singleRowY
    }
    const arrow = new Sprite(this.textures.arrow)
    arrow.label = 'game.history.arrow'
    arrow.position.set(
      MATCH_HISTORY_LAYOUT.preview.targetGrid.origin.x -
        (MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.size.width *
          MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.scale +
          MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.gapToCard),
      position.y + MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.offsetY
    )
    arrow.scale.set(MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.scale)
    this.preview.addChild(arrow)
    const definition = CARD_CATALOG.require(cardId)
    const artwork = await this.resolver.loadArtwork(cardId)
    if (this.activeId !== entry.id || sequence !== this.previewSequence) return
    const card = await CardView.create(definition, this.resolver, {
      artwork: artwork ?? undefined
    })
    if (this.activeId !== entry.id || sequence !== this.previewSequence) {
      card.destroy({ children: true })
      return
    }
    card.label = 'game.history.burned-card'
    card.eventMode = 'none'
    card.position.set(position.x, position.y)
    card.scale.set(MATCH_HISTORY_LAYOUT.preview.targetGrid.scale)
    this.preview.addChild(card)
  }

  private createFallbackSource(entry: MatchHistoryActionEntry): Container {
    const container = new Container()
    container.label = 'game.history.fallback-source'
    applyPlacement(container, MATCH_HISTORY_LAYOUT.preview.fallback)
    const title = historySourceTitle(entry.action)
    if (!title) return container
    const text = new Text({
      text: title,
      style: {
        fontFamily: 'Belwe',
        fontSize: 29,
        fill: 0xffffff,
        stroke: { color: 0x111111, width: 5 },
        align: 'center'
      },
      anchor: 0.5
    })
    text.position.set(117, 50)
    container.addChild(text)
    return container
  }

  private createHeroSource(
    heroId: NonNullable<HistoryActionOutcome['target']['heroId']>
  ): Sprite {
    const portrait = new Sprite(
      this.textures.heroFrames[HERO_CATALOG.require(heroId).presentationAssetKey]
    )
    portrait.label = 'game.history.source-hero-portrait'
    portrait.eventMode = 'none'
    applyAnchoredPlacement(portrait, MATCH_HISTORY_LAYOUT.preview.heroSource)
    return portrait
  }

  private heroPowerTexture(heroPowerId: string): Texture {
    const definition = HERO_POWER_CATALOG.require(heroPowerId)
    return this.textures.heroPowers[
      definition.presentationAssetKey as HeroPowerAssetKey
    ]
  }

  private createHeroPowerSource(heroPowerId: string, currentCost?: number): Container {
    const definition = HERO_POWER_CATALOG.require(heroPowerId)
    const source = new HeroPowerCardView(
      definition,
      currentCost ?? definition.cost,
      this.heroPowerTexture(heroPowerId),
      this.textures.heroPowerCardFrame
    )
    source.label = 'game.history.source-hero-power'
    source.eventMode = 'none'
    applyPlacement(source, MATCH_HISTORY_LAYOUT.preview.heroPowerSource)
    return source
  }

  private addOutcomePreviews(entry: MatchHistoryActionEntry, sequence: number): void {
    const localTargets = entry.targets.filter(
      (target) => target.target.participantId === this.localParticipantId
    )
    const remoteTargets = entry.targets.filter(
      (target) => target.target.participantId !== this.localParticipantId
    )
    const targets = [...localTargets, ...remoteTargets]
    if (targets.length === 0) return
    const bothSidesAffected = localTargets.length > 0 && remoteTargets.length > 0
    const firstRowY = bothSidesAffected
      ? MATCH_HISTORY_LAYOUT.preview.targetGrid.origin.y
      : MATCH_HISTORY_LAYOUT.preview.targetGrid.singleRowY

    const arrow = new Sprite(this.textures.arrow)
    arrow.label = 'game.history.arrow'
    arrow.position.set(
      MATCH_HISTORY_LAYOUT.preview.targetGrid.origin.x -
        (MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.size.width *
          MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.scale +
          MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.gapToCard),
      firstRowY + MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.offsetY
    )
    arrow.scale.set(MATCH_HISTORY_LAYOUT.preview.targetGrid.arrow.scale)
    this.preview.addChild(arrow)

    for (const [index, target] of targets.entries()) {
      const local = target.target.participantId === this.localParticipantId
      const rowIndex = local
        ? localTargets.indexOf(target)
        : remoteTargets.indexOf(target)
      const position = {
        x:
          MATCH_HISTORY_LAYOUT.preview.targetGrid.origin.x +
          rowIndex * MATCH_HISTORY_LAYOUT.preview.targetGrid.gapX,
        y: bothSidesAffected
          ? MATCH_HISTORY_LAYOUT.preview.targetGrid.origin.y +
            (local ? 0 : MATCH_HISTORY_LAYOUT.preview.targetGrid.gapY)
          : MATCH_HISTORY_LAYOUT.preview.targetGrid.singleRowY
      }
      void this.createOutcome(entry, target, index, position, sequence)
    }
  }

  private async createOutcome(
    entry: MatchHistoryEntry,
    targetResult: MatchHistoryTarget,
    index: number,
    position: { readonly x: number; readonly y: number },
    sequence: number
  ): Promise<void> {
    const { target, outcomes } = targetResult
    if (target.kind === 'hero' && target.heroId) {
      if (this.activeId === entry.id && sequence === this.previewSequence)
        this.preview.addChild(
          this.createHeroOutcome(target.heroId, outcomes, index, position)
        )
      return
    }
    if (this.shouldHideOutcomeCard(targetResult)) {
      if (this.activeId === entry.id && sequence === this.previewSequence) {
        const card = new Sprite(this.textures.cardBack)
        card.label = `game.history.outcome-card-back-${index}`
        card.eventMode = 'none'
        card.position.set(position.x, position.y)
        card.scale.set(MATCH_HISTORY_LAYOUT.preview.targetGrid.scale)
        this.preview.addChild(card)
        const badge = this.createOutcomeBadge(outcomes, index, position)
        if (badge) this.preview.addChild(badge)
      }
      return
    }
    const cardId = target.cardId
    if (!cardId) {
      if (this.activeId === entry.id && sequence === this.previewSequence)
        this.preview.addChild(this.createOutcomeFallback(outcomes, index, position))
      return
    }
    const definition = CARD_CATALOG.require(cardId)
    const artwork = await this.resolver.loadArtwork(cardId)
    if (this.activeId !== entry.id || sequence !== this.previewSequence) return
    const card = await CardView.create(definition, this.resolver, {
      artwork: artwork ?? undefined
    })
    if (this.activeId !== entry.id || sequence !== this.previewSequence) {
      card.destroy({ children: true })
      return
    }
    card.label = `game.history.outcome-card-${index}`
    card.eventMode = 'none'
    if (target.currentCost !== undefined) {
      card.setManaCost(target.currentCost)
      card.setManaCostColor(
        cardCostColor(target.baseCost ?? definition.cost, target.currentCost)
      )
    }
    card.position.set(position.x, position.y)
    card.scale.set(MATCH_HISTORY_LAYOUT.preview.targetGrid.scale)
    this.preview.addChild(card)
    const badge = this.createOutcomeBadge(outcomes, index, position)
    if (badge) this.preview.addChild(badge)
    const death = this.createOutcomeDeath(outcomes, index, position)
    if (death) this.preview.addChild(death)
  }

  private shouldHideOutcomeCard(targetResult: MatchHistoryTarget): boolean {
    return (
      targetResult.target.participantId !== this.localParticipantId &&
      (targetResult.target.kind === 'card' || targetResult.target.kind === 'hidden') &&
      targetResult.outcomes.some(
        (outcome) => outcome.kind === 'create-hand' || outcome.kind === 'draw'
      )
    )
  }

  private createOutcomeFallback(
    outcomes: readonly HistoryActionOutcome[],
    index: number,
    position: { readonly x: number; readonly y: number }
  ): Container {
    const container = new Container()
    container.label = `game.history.outcome-fallback-${index}`
    container.position.set(position.x, position.y)
    const text = historyOutcomeText(outcomes)
    if (!text) return container
    const label = new Text({
      text,
      style: {
        fontFamily: 'Belwe',
        fontSize: 25,
        fill: 0xffffff,
        stroke: { color: 0x111111, width: 5 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 132
      },
      anchor: 0.5
    })
    label.position.set(75, 46)
    container.addChild(label)
    return container
  }

  private createOutcomeBadge(
    outcomes: readonly HistoryActionOutcome[],
    index: number,
    position: { readonly x: number; readonly y: number }
  ): Container | null {
    const damage = outcomes.find(
      (outcome) => outcome.kind === 'damage' && (outcome.amount ?? 0) > 0
    )
    const text = historyOutcomeText(outcomes)
    if (!damage && !text) return null
    const container = new Container()
    container.label = `game.history.outcome-badge-${index}`
    if (damage) {
      container.position.set(
        position.x + MATCH_HISTORY_LAYOUT.preview.outcomeDamage.offsetX,
        position.y + MATCH_HISTORY_LAYOUT.preview.outcomeDamage.offsetY
      )
      const indicator = new DamageIndicatorView(
        this.textures.damageIndicator,
        damage.amount ?? 0
      )
      indicator.label = `game.history.damage-${index}`
      indicator.scale.set(MATCH_HISTORY_LAYOUT.preview.outcomeDamage.scale)
      container.addChild(indicator)
      return container
    }
    container.position.set(
      position.x,
      position.y + MATCH_HISTORY_LAYOUT.preview.outcomeBadge.offsetY
    )
    const label = new Text({
      text: text!,
      style: {
        fontFamily: 'Belwe',
        fontSize: 22,
        fill: 0xffffff,
        stroke: { color: 0x111111, width: 5 }
      },
      anchor: 0.5
    })
    label.position.set(75, 19)
    container.addChild(label)
    return container
  }

  private createOutcomeDeath(
    outcomes: readonly HistoryActionOutcome[],
    index: number,
    position: { readonly x: number; readonly y: number }
  ): Sprite | null {
    if (
      !outcomes.some(
        (outcome) => outcome.kind === 'death' || outcome.kind === 'destroy'
      )
    )
      return null
    const death = new Sprite(this.textures.willDie)
    death.label = `game.history.will-die-${index}`
    death.anchor.set(0.5)
    death.position.set(
      position.x + MATCH_HISTORY_LAYOUT.preview.outcomeDeath.offsetX,
      position.y + MATCH_HISTORY_LAYOUT.preview.outcomeDeath.offsetY
    )
    death.scale.set(MATCH_HISTORY_LAYOUT.preview.outcomeDeath.scale)
    return death
  }

  private createHeroOutcome(
    heroId: NonNullable<HistoryActionOutcome['target']['heroId']>,
    outcomes: readonly HistoryActionOutcome[],
    index: number,
    position: { readonly x: number; readonly y: number }
  ): Container {
    const container = new Container()
    container.label = `game.history.hero-outcome-${index}`
    container.position.set(position.x, position.y)
    const frame = new Sprite(
      this.textures.heroFrames[HERO_CATALOG.require(heroId).presentationAssetKey]
    )
    frame.label = `game.history.hero-portrait-${index}`
    frame.anchor.set(0.5)
    frame.position.set(
      MATCH_HISTORY_LAYOUT.preview.targetGrid.cardSize.width / 2,
      MATCH_HISTORY_LAYOUT.preview.targetGrid.cardSize.height / 2
    )
    frame.scale.set(MATCH_HISTORY_LAYOUT.preview.heroOutcome.scale)
    const badge = this.createOutcomeBadge(outcomes, index, { x: 0, y: 0 })
    container.addChild(frame)
    if (badge) container.addChild(badge)
    const death = this.createOutcomeDeath(outcomes, index, { x: 0, y: 0 })
    if (death) container.addChild(death)
    return container
  }
}
