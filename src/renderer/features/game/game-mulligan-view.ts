import { Container, Graphics, Sprite, type FederatedPointerEvent } from 'pixi.js'
import type { AnimationScope } from '../../animation/animations'
import { GhostAura } from '../../rendering/effects/ghost-aura'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import type { GameAssets } from '../../ui/asset-registry'
import { Button } from '../../ui/components/button'
import type { GameCardSlot } from './game-card-slot'
import type { OpeningCard } from '../../../game/match'
import { GAME_BOARD_LAYOUT } from './game-scene-layout'
import { OPENING_TIMING } from './game-presentation-timing'
import { completeTimeline } from './game-presentation-animation'

interface MulliganCardTransport {
  readonly travelLayer: Container
  prepareAtDeck(slot: GameCardSlot, index: number): void
  hasDrawOrigin(slot: GameCardSlot): boolean
  departDeck(slot: GameCardSlot, duration: number, delay: number): Promise<void>
}

/** Owns opening selection, its controls, presentation, and pointer listeners.
 * Card slots transfer to the hand; match/AI confirmation ordering stays with the board.
 */
export class GameMulliganView {
  readonly layer = new Container()
  private readonly initialSlots: GameCardSlot[] = []
  private readonly selectedIds = new Set<string>()
  private readonly selectionListeners = new Map<
    GameCardSlot,
    (event: FederatedPointerEvent) => void
  >()
  private confirmationLocked = false
  private mulliganInputReady = false
  private confirmButton!: Button
  private announcement: Sprite | null = null
  private mulliganAnnouncementOutline: GhostAura | null = null
  private confirmMulliganOutline: GhostAura | null = null
  private opponentStillChoosingOutline: GhostAura | null = null
  private opponentStillChoosing: Sprite | null = null

  constructor(
    private readonly assets: GameAssets,
    private readonly animations: Pick<AnimationScope, 'timeline'>,
    private readonly transport: MulliganCardTransport,
    private readonly onConfirm: () => void
  ) {
    this.layer.sortableChildren = true
  }

  get initialCardCount(): number {
    return this.initialSlots.length
  }

  enableSelection(): void {
    this.syncMulliganSelectionVisuals()
    this.setInputEnabled(true)
    this.confirmButton.visible = true
    this.confirmMulliganOutline?.setEnabled(true)
    this.confirmButton.setEnabled(true)
  }

  beginConfirmation(slots: readonly GameCardSlot[]): readonly string[] | null {
    if (this.confirmationLocked) return null
    this.confirmationLocked = true
    this.setInputEnabled(false)
    this.confirmButton.setEnabled(false)
    this.confirmMulliganOutline?.disappear(this.layer.parent)
    for (const slot of slots) {
      slot.setMulliganInteractionEnabled(false)
      slot.setPlayableOutlineEnabled(false)
    }
    return [...this.selectedIds]
  }

  rejectConfirmation(): void {
    this.confirmationLocked = false
    this.enableSelection()
  }

  disableConfirmation(): void {
    this.confirmButton?.setEnabled(false)
  }

  async hide(): Promise<void> {
    this.disappearControls()
    await this.fadeTo(this.layer, 0, OPENING_TIMING.mulliganFade)
    this.layer.visible = false
  }

  dispose(): void {
    for (const [slot, listener] of this.selectionListeners)
      slot.off('pointertap', listener)
    this.selectionListeners.clear()
    this.mulliganAnnouncementOutline?.dispose()
    this.mulliganAnnouncementOutline = null
    this.confirmMulliganOutline?.dispose()
    this.confirmMulliganOutline = null
    this.opponentStillChoosingOutline?.dispose()
    this.opponentStillChoosingOutline = null
    this.confirmButton?.dispose()
    this.layer.destroy({ children: true })
  }

  createLayer(): void {
    const overlay = this.createDarkOverlay()
    overlay.label = 'game.mulligan.dark-overlay'
    overlay.alpha = 0
    this.layer.addChild(overlay)

    const announcement = new Sprite(this.assets.mulliganAnnouncement)
    applyAnchoredPlacement(announcement, GAME_BOARD_LAYOUT.mulligan.announcement)
    announcement.label = 'game.mulligan.announcement'
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.layer.addChild(announcement)
    this.announcement = announcement
    this.mulliganAnnouncementOutline = new GhostAura(announcement, {
      noise: this.assets.burnNoise,
      dissolve: this.assets.ghostDissolve,
      spotlight: this.assets.ghostSpotlight
    })
  }

  private createDarkOverlay(): Graphics {
    const overlay = new Graphics()
    overlay.rect(0, 0, 1920, 1080)
    overlay.fill({ color: 0x000000, alpha: 0.8 })
    overlay.eventMode = 'none'
    return overlay
  }

  createControls(): void {
    this.confirmButton = new Button(this.assets.confirmMulliganButton, {
      pressedScale: 1,
      highlightOnHover: false,
      hoverScale: 1.05,
      onClick: () => void this.onConfirm()
    })
    this.confirmButton.label = 'game.mulligan.confirm'
    applyPlacement(this.confirmButton, GAME_BOARD_LAYOUT.mulligan.confirmButton)
    this.confirmButton.setBaseY(GAME_BOARD_LAYOUT.mulligan.confirmButton.position.y)
    this.confirmButton.visible = false
    this.confirmButton.setEnabled(false)
    this.layer.addChild(this.confirmButton)
    this.confirmMulliganOutline = new GhostAura(this.confirmButton, {
      silhouette: this.confirmButton.sprite,
      noise: this.assets.burnNoise,
      dissolve: this.assets.ghostDissolve,
      spotlight: this.assets.ghostSpotlight
    })
    this.confirmMulliganOutline.setEnabled(false)

    this.opponentStillChoosing = new Sprite(this.assets.mulliganOpponentStillChoosing)
    applyAnchoredPlacement(
      this.opponentStillChoosing,
      GAME_BOARD_LAYOUT.mulligan.opponentStillChoosing
    )
    this.opponentStillChoosing.eventMode = 'none'
    this.opponentStillChoosing.label = 'game.mulligan.opponent-still-choosing'
    this.opponentStillChoosing.visible = false
    this.layer.addChild(this.opponentStillChoosing)
    this.opponentStillChoosingOutline = new GhostAura(this.opponentStillChoosing, {
      noise: this.assets.burnNoise,
      dissolve: this.assets.ghostDissolve,
      spotlight: this.assets.ghostSpotlight
    })
    this.opponentStillChoosingOutline.setEnabled(false)
  }

  async createInitialCards(
    cards: readonly OpeningCard[],
    createSlot: (card: OpeningCard) => Promise<GameCardSlot>
  ): Promise<readonly { card: OpeningCard; slot: GameCardSlot }[]> {
    const entries = await Promise.all(
      cards.map(async (card) => {
        const slot = await createSlot(card)
        this.registerSlot(slot)
        return { card, slot }
      })
    )
    // Artwork may finish out of order; the opening spread follows hand order.
    this.initialSlots.push(...entries.map((entry) => entry.slot))
    return entries
  }

  private registerSlot(slot: GameCardSlot): void {
    slot.alpha = 0
    const onTap = (event: FederatedPointerEvent): void => {
      if (this.confirmationLocked || !this.mulliganInputReady || event.button !== 0)
        return
      const selected = !this.selectedIds.has(slot.instanceId)
      if (selected) this.selectedIds.add(slot.instanceId)
      else this.selectedIds.delete(slot.instanceId)
      slot.setSelected(selected)
      slot.setPlayableOutlineEnabled(!selected)
    }
    slot.on('pointertap', onTap)
    this.selectionListeners.set(slot, onTap)
    this.layer.addChild(slot)
  }

  setInputEnabled(enabled: boolean): void {
    this.mulliganInputReady = enabled
    for (const slot of this.initialSlots) {
      slot.setMulliganInteractionEnabled(enabled)
    }
  }

  private syncMulliganSelectionVisuals(): void {
    for (const slot of this.initialSlots) {
      const selected = this.selectedIds.has(slot.instanceId)
      slot.setSelected(selected)
      slot.setPlayableOutlineEnabled(!selected)
    }
  }

  async present(): Promise<void> {
    const announcement = this.announcement
    const overlay = this.layer.getChildByLabel('game.mulligan.dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    this.mulliganAnnouncementOutline?.setEnabled(true)
    await Promise.all([
      this.fadeTo(overlay, 1, OPENING_TIMING.mulliganFade),
      this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    ])
  }

  async presentPlayerTwoAnnouncement(): Promise<void> {
    const announcement = new Sprite(this.assets.mulliganCoinAnnouncement)
    applyAnchoredPlacement(announcement, GAME_BOARD_LAYOUT.mulligan.coinAnnouncement)
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.layer.addChild(announcement)
    await this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    await this.wait(OPENING_TIMING.playerTwoAnnouncementHold)
    await this.fadeTo(announcement, 0, OPENING_TIMING.playerTwoAnnouncementFade)
    announcement.destroy()
  }

  async dealInitialCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.initialSlots.slice(start, end).map((slot, offset) => {
        const index = start + offset
        this.transport.prepareAtDeck(slot, index)
        this.transport.travelLayer.addChild(slot)
        return this.animateSlot(slot, index, this.initialSlots.length, duration, offset)
      })
    )
  }

  animateSlot(
    slot: GameCardSlot,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const layout = GAME_BOARD_LAYOUT.mulligan.cards
    const gap = count === 3 ? layout.threeCardGap : layout.gap
    const x = layout.centerX + (index - midpoint) * gap
    if (this.transport.hasDrawOrigin(slot)) {
      slot.position.set(x, GAME_BOARD_LAYOUT.mulligan.cards.baselineY)
      slot.scale.set(GAME_BOARD_LAYOUT.mulligan.cards.scale)
      slot.skew.set(0, 0)
      slot.rotation = 0
      return this.transport
        .departDeck(slot, duration, staggerIndex * OPENING_TIMING.localRevealStagger)
        .then(() => {
          if (!slot.destroyed && !this.layer.destroyed) this.layer.addChild(slot)
        })
    }
    const timeline = this.animations.timeline()
    timeline.to(slot, {
      x,
      y: GAME_BOARD_LAYOUT.mulligan.cards.baselineY,
      rotation: 0,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.localRevealStagger,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: GAME_BOARD_LAYOUT.mulligan.cards.scale,
        y: GAME_BOARD_LAYOUT.mulligan.cards.scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.localRevealStagger,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration,
        delay: staggerIndex * OPENING_TIMING.localRevealStagger,
        ease: 'power2.out'
      },
      0
    )
    return completeTimeline(timeline, () => {
      this.layer.addChild(slot)
    })
  }

  showConfirmed(waitingForOpponent: boolean): void {
    this.mulliganAnnouncementOutline?.disappear(this.layer.parent)

    if (!waitingForOpponent) return
    if (this.opponentStillChoosing) this.opponentStillChoosing.visible = true
    this.opponentStillChoosingOutline?.setEnabled(true)
  }

  async dismiss(): Promise<void> {
    const overlay = this.layer.getChildByLabel('game.mulligan.dark-overlay')
    if (!overlay) throw new Error('Mulligan presentation is unavailable.')
    this.disappearControls()
    await this.fadeTo(overlay, 0, OPENING_TIMING.mulliganFade)
  }

  private disappearControls(): void {
    this.confirmButton?.setEnabled(false)
    for (const effect of [
      this.confirmMulliganOutline,
      this.mulliganAnnouncementOutline,
      this.opponentStillChoosingOutline
    ])
      effect?.disappear(this.layer.parent)
  }

  private fadeTo(
    target: { alpha: number },
    alpha: number,
    duration: number
  ): Promise<void> {
    return completeTimeline(
      this.animations.timeline().to(target, { alpha, duration, ease: 'power2.out' })
    )
  }

  private wait(duration: number): Promise<void> {
    return completeTimeline(this.animations.timeline().to({}, { duration }))
  }
}
