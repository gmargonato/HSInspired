import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
  type FederatedWheelEvent
} from 'pixi.js'
import { CARD_CATALOG } from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type {
  CardBurnedEvent,
  HistoryActionResolvedEvent,
  HistoryActionOutcome,
  HistoryEntitySnapshot
} from '../../../game/match'
import { CardView } from '../../rendering/cards/card-view'
import { HeroPowerCardView } from '../../rendering/hero-powers/hero-power-presentation'
import { DamageIndicatorView } from './damage-indicator-view'
import { HealIndicatorView } from './heal-indicator-view'
import { applyPlacement, applyAnchoredPlacement } from '../../rendering/layout'
import { Actor } from '../../ui/components/actor'
import type { DeckPresentationAssets, HeroPowerAssetKey } from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import {
  MATCH_HISTORY_LAYOUT,
  HISTORY_CARD_DETAILS,
  historyTargetPlacements
} from './match-history-layout'
import {
  MatchHistoryModel,
  type MatchHistoryEntry,
  type MatchHistoryTarget
} from './match-history-model'

export interface MatchHistoryTextures {
  readonly local: Texture
  readonly remote: Texture
  readonly localAttack: Texture
  readonly localTrigger: Texture
  readonly remoteAttack: Texture
  readonly remoteTrigger: Texture
  readonly arrow: Texture
  readonly burnCard: Texture
  readonly burnThumb: Texture
  readonly damageIndicator: Texture
  readonly healIndicator: Texture
  readonly willDie: Texture
  readonly secretCard: Texture
  readonly secretThumb: Texture
  readonly fatigueCard: Texture
  readonly fatigueThumb: Texture
  readonly cardBack: Texture
  readonly heroAttack: Texture
  readonly heroHealth: Texture
  readonly heroArmor: Texture
  readonly heroFrames: DeckPresentationAssets
  readonly heroPowers: Record<HeroPowerAssetKey, Texture>
  readonly heroPowerCardFrame: Texture
}

interface RailSlot {
  readonly container: Container
  readonly artwork: Sprite
  readonly frame: Sprite
  entry?: MatchHistoryEntry
  generation: number
}

/** Only visible thumbnails and the active preview have Pixi objects. */
export class MatchHistoryView extends Actor {
  private readonly model: MatchHistoryModel
  readonly rail = new Container()
  private readonly preview = new Container()
  private readonly resolver = new CardAssetResolver()
  private readonly slots: RailSlot[] = []
  private offset = 0
  private hoveredIndex: number | null = null
  private activeId: number | null = null
  private previewSequence = 0

  constructor(
    private readonly textures: MatchHistoryTextures,
    private readonly localParticipantId: string,
    private readonly setBoardDesaturated: (active: boolean) => void,
    private readonly premiumFor: (snapshot: HistoryEntitySnapshot) => boolean = () =>
      false,
    private readonly premiumSideFor: (
      snapshot: HistoryEntitySnapshot
    ) => 'local' | 'remote' = (snapshot) =>
      (snapshot.ownerId ?? snapshot.participantId) === localParticipantId
        ? 'local'
        : 'remote'
  ) {
    super()
    this.model = new MatchHistoryModel(localParticipantId)
    this.label = 'game.history'
    this.eventMode = 'passive'
    this.rail.label = 'game.history.rail'
    this.rail.eventMode = 'static'
    this.rail.cursor = 'pointer'
    const layout = MATCH_HISTORY_LAYOUT.rail
    this.rail.position.set(layout.frame.position.x, layout.frame.position.y)
    this.rail.hitArea = new Rectangle(0, 0, 75, (layout.capacity - 1) * layout.gap + 75)
    this.preview.label = 'game.history.preview'
    this.preview.eventMode = 'none'
    this.addChild(this.rail, this.preview)
    for (let index = 0; index < layout.capacity; index++)
      this.slots.push(this.createSlot(index))
    this.rail.on('pointermove', (event: FederatedPointerEvent) => this.hover(event))
    this.rail.on('pointerenter', (event: FederatedPointerEvent) => this.hover(event))
    this.rail.on('pointerleave', () => {
      this.hoveredIndex = null
      this.close()
    })
    this.rail.on('wheel', (event: FederatedWheelEvent) => {
      event.stopPropagation()
      event.preventDefault()
      if (event.deltaY === 0) return
      this.offset = Math.max(
        0,
        Math.min(
          this.model.count - layout.capacity,
          this.offset + Math.sign(event.deltaY)
        )
      )
      this.renderRail()
      this.openHovered()
    })
  }

  record(event: HistoryActionResolvedEvent): void {
    const count = this.model.count
    const knownIds = new Set(this.model.all().map((historyEntry) => historyEntry.id))
    const shown =
      this.hoveredIndex === null ? undefined : this.slots[this.hoveredIndex]?.entry
    const entry = this.model.record(event)
    if (this.offset > 0) this.offset += this.model.count - count
    const enteringId =
      this.offset === 0 && !knownIds.has(entry.id) ? entry.id : undefined
    this.renderRail(enteringId)
    if (
      this.activeId === entry.id ||
      (this.hoveredIndex !== null && this.slots[this.hoveredIndex]?.entry !== shown)
    )
      this.openHovered()
  }
  recordBurn(event: CardBurnedEvent): void {
    const entry = this.model.recordBurn(event)
    if (this.offset > 0) this.offset++
    this.renderRail(this.offset === 0 ? entry.id : undefined)
    if (this.hoveredIndex !== null) this.openHovered()
  }

  private hover(event: FederatedPointerEvent): void {
    const point = this.rail.toLocal(event.global)
    const index = Math.min(
      this.slots.length - 1,
      Math.floor(point.y / MATCH_HISTORY_LAYOUT.rail.gap)
    )
    if (index < 0 || !this.slots[index]?.entry) {
      this.hoveredIndex = null
      this.close()
      return
    }
    if (this.hoveredIndex === index && this.activeId === this.slots[index].entry?.id)
      return
    this.hoveredIndex = index
    this.openHovered()
  }
  private openHovered(): void {
    const entry =
      this.hoveredIndex === null ? undefined : this.slots[this.hoveredIndex]?.entry
    if (!entry) {
      this.close()
      return
    }
    const pending = this.open(entry)
    const sequence = this.previewSequence
    void pending.catch(() => {
      if (this.current(entry.id, sequence)) this.close()
    })
  }
  private createSlot(index: number): RailSlot {
    const container = new Container()
    container.label = 'game.history.slot-' + index
    container.position.y = index * MATCH_HISTORY_LAYOUT.rail.gap
    container.eventMode = 'none'
    container.visible = false
    const artwork = new Sprite(this.textures.secretThumb)
    artwork.label = 'game.history.thumbnail-' + index
    const mask = new Graphics().roundRect(9, 9, 57, 57, 5).fill(0xffffff)
    mask.label = 'game.history.thumbnail-mask-' + index
    artwork.mask = mask
    const frame = new Sprite(this.textures.local)
    frame.label = 'game.history.frame-' + index
    container.addChild(artwork, mask, frame)
    this.rail.addChild(container)
    return { container, artwork, frame, generation: 0 }
  }
  private renderRail(enteringId?: number): void {
    const entries = this.model.visible(this.offset, this.slots.length)
    const previousSlots = [...this.slots]
    const targetIds = new Set(entries.map((entry) => entry.id))
    const available = [...previousSlots]
    const orderedSlots = entries.map((entry) => {
      const matchingIndex = available.findIndex((slot) => slot.entry?.id === entry.id)
      const reusableIndex =
        matchingIndex >= 0
          ? matchingIndex
          : available.findIndex(
              (slot) => slot.entry === undefined || !targetIds.has(slot.entry.id)
            )
      if (reusableIndex < 0) throw new Error('History rail ran out of reusable slots.')
      const slot = available.splice(reusableIndex, 1)[0]
      if (!slot) throw new Error('History rail ran out of reusable slots.')
      return slot
    })
    const unusedSlots = previousSlots.filter((slot) => !orderedSlots.includes(slot))
    this.slots.splice(0, this.slots.length, ...orderedSlots, ...unusedSlots)

    this.slots.forEach((slot, index) => {
      const entry = entries[index]
      if (!entry) {
        slot.entry = undefined
        slot.container.visible = false
        this.killTweensOf(slot.container)
        slot.container.position.set(0, index * MATCH_HISTORY_LAYOUT.rail.gap)
        slot.generation++
        return
      }

      const contentChanged = slot.entry !== entry
      slot.entry = entry
      slot.container.visible = true
      if (contentChanged) this.renderSlotContent(slot)

      const targetY = index * MATCH_HISTORY_LAYOUT.rail.gap
      if (entry.id === enteringId) {
        this.killTweensOf(slot.container)
        slot.container.position.set(
          MATCH_HISTORY_LAYOUT.rail.entryAnimation.incomingOffsetX,
          targetY
        )
        this.tweenTo(slot.container, {
          x: 0,
          duration: MATCH_HISTORY_LAYOUT.rail.entryAnimation.duration,
          ease: 'power2.out',
          overwrite: 'auto'
        })
      } else if (enteringId !== undefined) {
        this.tweenTo(slot.container, {
          x: 0,
          y: targetY,
          duration: MATCH_HISTORY_LAYOUT.rail.entryAnimation.duration,
          ease: 'power2.out',
          overwrite: 'auto'
        })
      } else {
        this.killTweensOf(slot.container)
        slot.container.position.set(0, targetY)
      }
    })
  }
  private renderSlotContent(slot: RailSlot): void {
    const entry = slot.entry
    const generation = ++slot.generation
    if (!entry) return
    const side = entry.participantId === this.localParticipantId ? 'local' : 'remote'
    switch (entry.action) {
      case 'combat':
        slot.frame.texture = this.textures[`${side}Attack`]
        break
      case 'trigger':
        slot.frame.texture = this.textures[`${side}Trigger`]
        break
      default:
        slot.frame.texture = this.textures[side]
    }
    this.showThumbnail(slot.artwork, Texture.WHITE)
    slot.artwork.tint = 0x000000
    if (entry.kind !== 'burn' && entry.source.concealedAs === 'secret')
      this.showThumbnail(slot.artwork, this.textures.secretThumb)
    if (entry.kind === 'burn') this.showThumbnail(slot.artwork, this.textures.burnThumb)
    else if (entry.action === 'fatigue')
      this.showThumbnail(slot.artwork, this.textures.fatigueThumb)
    else if (entry.source.heroPowerId)
      this.showThumbnail(slot.artwork, this.heroPowerTexture(entry.source.heroPowerId))
    else if (entry.source.heroId)
      this.showThumbnail(slot.artwork, this.heroTexture(entry.source.heroId))
    else if (entry.source.cardId)
      void this.resolver
        .loadArtwork(entry.source.cardId)
        .then((texture) => {
          if (!this.destroyed && generation === slot.generation && texture)
            this.showThumbnail(slot.artwork, texture)
        })
        .catch(() => {
          /* Keep the explicit placeholder if artwork fails. */
        })
  }
  private showThumbnail(sprite: Sprite, texture: Texture): void {
    const size = MATCH_HISTORY_LAYOUT.rail.artworkSize
    sprite.texture = texture
    sprite.tint = 0xffffff
    const scale = Math.max(size / texture.width, size / texture.height)
    sprite.scale.set(scale)
    sprite.position.set(
      9 + (size - texture.width * scale) / 2,
      9 + (size - texture.height * scale) / 2
    )
  }
  private current(id: number, sequence: number): boolean {
    return !this.destroyed && this.activeId === id && this.previewSequence === sequence
  }
  private close(): void {
    this.activeId = null
    this.previewSequence++
    this.preview.removeChildren().forEach((child) => child.destroy({ children: true }))
    this.setBoardDesaturated(false)
  }
  override dispose(): void {
    this.close()
    super.dispose()
  }
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.killAnimations()
    this.activeId = null
    this.previewSequence++
    this.setBoardDesaturated(false)
    // The board mounts the rail below the hand, separately from this preview.
    if (!this.rail.destroyed) this.rail.destroy({ children: true })
    super.destroy(options)
  }

  private async open(entry: MatchHistoryEntry): Promise<void> {
    this.close()
    this.activeId = entry.id
    const sequence = ++this.previewSequence
    this.setBoardDesaturated(true)
    const source = new Container()
    source.label = 'game.history.source'
    applyPlacement(source, MATCH_HISTORY_LAYOUT.preview.source)
    this.preview.addChild(source)
    let targets: readonly MatchHistoryTarget[]
    if (entry.kind === 'burn') {
      this.textureCard(source, this.textures.burnCard)
      targets = [
        {
          target: {
            id: entry.card.instanceId,
            participantId:
              entry.participantId as HistoryEntitySnapshot['participantId'],
            kind: 'card',
            cardId: entry.card.cardId,
            currentCost: entry.card.currentCost
          },
          outcomes: []
        }
      ]
    } else {
      targets = entry.targets
      if (entry.action === 'fatigue') {
        this.textureCard(source, this.textures.fatigueCard)
        this.indicators(
          source,
          entry.outcomes.map((outcome) => ({ ...outcome, kind: 'damage' }))
        )
        targets = []
      } else if (entry.source.heroPowerId) {
        const definition = HERO_POWER_CATALOG.require(entry.source.heroPowerId)
        source.addChild(
          new HeroPowerCardView(
            definition,
            entry.source.currentCost ?? definition.cost,
            this.heroPowerTexture(entry.source.heroPowerId),
            this.textures.heroPowerCardFrame
          )
        )
      } else {
        await this.entity(source, entry.source, entry.id, sequence)
        if (!this.current(entry.id, sequence)) return
        this.indicators(source, entry.sourceOutcomes)
      }
    }
    if (!this.current(entry.id, sequence) || targets.length === 0) return
    const arrow = new Sprite(this.textures.arrow)
    arrow.label = 'game.history.arrow'
    applyAnchoredPlacement(arrow, MATCH_HISTORY_LAYOUT.preview.arrow)
    this.preview.addChild(arrow)
    const placements = historyTargetPlacements(targets.length)
    // Stable containers are inserted before artwork loads, preserving result order.
    await Promise.all(
      targets.map(async ({ target, outcomes }, index) => {
        const position = placements[index]
        const container = new Container()
        container.label = 'game.history.result-' + index
        container.position.set(position.x, position.y)
        container.scale.set(position.scale)
        this.preview.addChild(container)
        await this.entity(container, target, entry.id, sequence)
        if (!this.current(entry.id, sequence)) return
        this.indicators(container, outcomes)
      })
    )
  }
  private heroTexture(heroId: NonNullable<HistoryEntitySnapshot['heroId']>): Texture {
    return this.textures.heroFrames[HERO_CATALOG.require(heroId).presentationAssetKey]
  }
  private heroPowerTexture(id: string): Texture {
    return this.textures.heroPowers[
      HERO_POWER_CATALOG.require(id).presentationAssetKey as HeroPowerAssetKey
    ]
  }
  private textureCard(container: Container, texture: Texture): void {
    const sprite = new Sprite(texture)
    sprite.label = 'game.history.card-image'
    sprite.width = HISTORY_CARD_DETAILS.size.width
    sprite.height = HISTORY_CARD_DETAILS.size.height
    container.addChild(sprite)
  }
  private async entity(
    container: Container,
    snapshot: HistoryEntitySnapshot,
    id: number,
    sequence: number
  ): Promise<void> {
    if (snapshot.heroPowerId) {
      const definition = HERO_POWER_CATALOG.require(snapshot.heroPowerId)
      container.addChild(
        new HeroPowerCardView(
          definition,
          snapshot.currentCost ?? definition.cost,
          this.heroPowerTexture(snapshot.heroPowerId),
          this.textures.heroPowerCardFrame
        )
      )
      return
    }
    if (snapshot.kind === 'hero' && snapshot.heroId) {
      const portrait = new Sprite(this.heroTexture(snapshot.heroId))
      portrait.label = 'game.history.hero'
      applyAnchoredPlacement(portrait, HISTORY_CARD_DETAILS.hero)
      container.addChild(portrait)
      if (snapshot.health !== undefined)
        this.heroStat(
          container,
          snapshot.health,
          HISTORY_CARD_DETAILS.heroStats.health,
          this.textures.heroHealth
        )
      if (snapshot.armor)
        this.heroStat(
          container,
          snapshot.armor,
          HISTORY_CARD_DETAILS.heroStats.armor,
          this.textures.heroArmor
        )
      if (snapshot.attack)
        this.heroStat(
          container,
          snapshot.attack,
          HISTORY_CARD_DETAILS.heroStats.attack,
          this.textures.heroAttack
        )
      return
    }
    if (!snapshot.cardId) {
      this.textureCard(
        container,
        snapshot.concealedAs === 'secret'
          ? this.textures.secretCard
          : this.textures.cardBack
      )
      return
    }
    const definition = CARD_CATALOG.require(snapshot.cardId)
    const artwork = await this.resolver
      .loadArtwork(snapshot.cardId)
      .catch(() => undefined)
    if (!this.current(id, sequence)) return
    const card = await CardView.create(definition, this.resolver, {
      premium: this.premiumFor(snapshot),
      premiumSide: this.premiumSideFor(snapshot),
      animatePremiumArtwork: true,
      artwork,
      snapshot,
      silenced: snapshot.silenced
    })
    if (!this.current(id, sequence)) {
      card.destroy({ children: true })
      return
    }
    card.label = 'game.history.snapshot-card'
    card.eventMode = 'none'
    container.addChild(card)
  }
  private makeLabel(text: string, size: number, color = 0xffffff): Text {
    const label = new Text({
      text,
      style: {
        fontFamily: 'Belwe',
        fontSize: size,
        fill: color,
        stroke: { color: 0x17120f, width: 6 },
        align: 'center'
      },
      anchor: 0.5
    })
    label.label = 'game.history.annotation'
    return label
  }
  private heroStat(
    container: Container,
    value: number,
    point: { readonly x: number; readonly y: number },
    texture: Texture
  ): void {
    const { x, y } = point
    const badge = new Sprite(texture)
    badge.anchor.set(0.5)
    badge.position.set(x, y)
    badge.scale.set(HISTORY_CARD_DETAILS.heroStats.badgeHeight / texture.height)
    badge.label = 'game.history.hero-stat'
    container.addChild(badge)
    const label = this.makeLabel(String(value), 88)
    label.position.set(x, y)
    container.addChild(label)
  }
  private indicators(
    container: Container,
    outcomes: readonly HistoryActionOutcome[]
  ): void {
    const total = (kind: HistoryActionOutcome['kind']): number =>
      outcomes.reduce(
        (sum, outcome) => sum + (outcome.kind === kind ? (outcome.amount ?? 0) : 0),
        0
      )
    const damage = total('damage'),
      heal = total('heal')
    if (damage > 0) {
      const burst = new DamageIndicatorView(this.textures.damageIndicator, damage)
      burst.label = 'game.history.damage'
      applyPlacement(burst, HISTORY_CARD_DETAILS.damage)
      container.addChild(burst)
    }
    const hits = outcomes.filter(
      (outcome) => outcome.kind === 'damage' && (outcome.amount ?? 0) > 0
    ).length
    if (hits > 1) {
      const label = this.makeLabel('\u00d7' + hits, 48)
      applyAnchoredPlacement(label, HISTORY_CARD_DETAILS.hits)
      container.addChild(label)
    }
    if (heal > 0) {
      const label = new HealIndicatorView(this.textures.healIndicator, heal)
      label.label = 'game.history.heal'
      applyPlacement(
        label,
        damage > 0 ? HISTORY_CARD_DETAILS.mixedHeal : HISTORY_CARD_DETAILS.heal
      )
      container.addChild(label)
    }
    if (
      outcomes.some((outcome) => outcome.kind === 'death' || outcome.kind === 'destroy')
    ) {
      const skull = new Sprite(this.textures.willDie)
      skull.label = 'game.history.death'
      applyAnchoredPlacement(skull, HISTORY_CARD_DETAILS.death)
      const scale = Math.min(
        HISTORY_CARD_DETAILS.death.size.width / skull.texture.width,
        HISTORY_CARD_DETAILS.death.size.height / skull.texture.height
      )
      skull.scale.set(scale)
      container.addChild(skull)
    }
    if (
      damage === 0 &&
      outcomes.some(
        (outcome) => outcome.kind === 'shield-lost' || outcome.kind === 'prevented'
      )
    ) {
      const burst = new DamageIndicatorView(this.textures.damageIndicator, 0)
      burst.label = 'game.history.prevented'
      applyPlacement(burst, HISTORY_CARD_DETAILS.damage)
      container.addChild(burst)
    }
  }
}
