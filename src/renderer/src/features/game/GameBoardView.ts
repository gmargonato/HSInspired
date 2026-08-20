import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent
} from 'pixi.js'
import type { Deck } from '../../../../game/decks'
import { CARD_CATALOG, type CardDefinition } from '../../../../game/content/cards'
import { HERO_CATALOG } from '../../../../game/content/heroes'
import {
  createOpeningMatch,
  type MulliganResolvedEvent,
  type OpeningCard,
  type OpeningMatchEvent,
  type OpeningMatchInstance,
  type OpeningMatchState
} from '../../../../game/match'
import type { PlayerId } from '../../../../game/match'
import type { AudioService } from '../../app/audio'
import type { GameRoute } from '../../app/router'
import type { AppLogger } from '../../app/services'
import { CardView } from '../../rendering/cards/card-view'
import { type DeckPresentationAssets, type GameAssets } from '../../ui/asset-registry'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { Actor } from '../../ui/components/Actor'
import { Button } from '../../ui/components/Button'
import { DEFAULT_HAND_LAYOUT, layoutHand } from './hand-layout'

export interface GameBoardViewOptions {
  readonly route: GameRoute
  readonly decks: readonly Deck[]
  readonly gameAssets: GameAssets
  readonly heroAssets: DeckPresentationAssets
  readonly audio?: AudioService
  readonly logger?: AppLogger
}

export const GAME_SCENE_LAYOUT = {
  board: { x: 960, y: 540, scale: 1 },
  localHero: { x: 960, y: 852, scale: 0.46 },
  remoteHero: { x: 960, y: 184, scale: 0.46 },
  localIntroHero: { x: 350, y: 665, scale: 1 },
  remoteIntroHero: { x: 1540, y: 250, scale: 1 },
  localDeck: { x: 1650, y: 640, scale: 0.82 },
  remoteDeck: { x: 1650, y: 390, scale: 0.82 },
  localMulligan: { centerX: 960, baselineY: 710, gap: 250, scale: 0.38 },
  remoteHand: { centerX: 960, baselineY: 92, gap: 52, scale: 0.22 },
  confirmButton: { x: 960, y: 855 },
  mulliganAnnouncement: { x: 960, y: 72 },
  coinAnnouncement: { x: 1450, y: 590, scale: 0.55 }
} as const

/** Feature-local timings make the opening easy to tune without layout edits. */
const OPENING_TIMING = {
  versusHold: 1,
  heroSettle: 0.6,
  boardPause: 0.5,
  mulliganFade: 0.3,
  cardDeal: 0.75,
  cardStagger: 0.18,
  playerTwoAnnouncementHold: 0.9,
  playerTwoAnnouncementFade: 0.25,
  playerTwoFourthCard: 0.65,
  confirmationPause: 0.5,
  replacementPause: 0.25,
  handoffPause: 0.5,
  handSettle: 0.48,
  hover: 0.2
} as const

function cardDefinition(card: OpeningCard): CardDefinition {
  return CARD_CATALOG.require(card.cardId)
}

function cloneCard(card: OpeningCard): OpeningCard {
  return { ...card }
}

class GameCardSlot extends Container {
  readonly card: CardView
  readonly instanceId: string
  private readonly replaceCross: Sprite
  private readonly replacedLabel: Sprite

  constructor(
    card: CardView,
    instanceId: string,
    replaceCrossTexture: Texture,
    replacedLabelTexture: Texture
  ) {
    super()
    this.card = card
    this.instanceId = instanceId
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(-310, -900, 620, 900)
    this.label = `game-card:${instanceId}`

    card.eventMode = 'none'
    card.position.set(-310, -900)
    this.addChild(card)

    this.replaceCross = new Sprite(replaceCrossTexture)
    this.replaceCross.anchor.set(0.5)
    this.replaceCross.position.set(0, -450)
    this.replaceCross.scale.set(2)
    this.replaceCross.visible = false
    this.replaceCross.eventMode = 'none'
    this.addChild(this.replaceCross)

    this.replacedLabel = new Sprite(replacedLabelTexture)
    this.replacedLabel.anchor.set(0.5, 0)
    this.replacedLabel.position.set(0, 24)
    this.replacedLabel.scale.set(2)
    this.replacedLabel.visible = false
    this.replacedLabel.eventMode = 'none'
    this.addChild(this.replacedLabel)
  }

  setSelected(selected: boolean): void {
    this.replaceCross.visible = selected
    this.replacedLabel.visible = selected
  }
}

/** Feature-owned board, opening choreography, mulligan, and local hand interaction. */
export class GameBoardView extends Actor {
  private readonly resolver = new CardAssetResolver()
  private readonly localSlots = new Map<string, GameCardSlot>()
  private readonly selectedIds = new Set<string>()
  private readonly localHand: OpeningCard[] = []
  private readonly initialSlots: GameCardSlot[] = []
  private readonly remoteBacks: Sprite[] = []
  private readonly boardLayer = new Container()
  private readonly heroLayer = new Container()
  private readonly openingLayer = new Container()
  private readonly travelLayer = new Container()
  private readonly deckLayer = new Container()
  private readonly mulliganLayer = new Container()
  private readonly handLayer = new Container()
  private readonly remoteHandLayer = new Container()
  private readonly heroSprites = new Map<PlayerId, Sprite>()
  private readonly logger: AppLogger
  private match!: OpeningMatchInstance
  private localParticipantId!: PlayerId
  private remoteParticipantId!: PlayerId
  private localPlayerNumber!: 1 | 2
  private remotePlayerNumber!: 1 | 2
  private localHoveredIndex: number | null = null
  private confirmButton!: Button
  private confirmationLocked = false
  private remoteBackCount = 0
  private openingRevealStarted = false

  constructor(private readonly options: GameBoardViewOptions) {
    super()
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    this.addChild(this.boardLayer)
    this.addChild(this.openingLayer)
    this.addChild(this.heroLayer)
    this.addChild(this.deckLayer)
    this.addChild(this.mulliganLayer)
    // Dealt cards must stay above the mulligan dimmer while they travel from
    // the deck; they are reparented to their final layers after the animation.
    this.addChild(this.travelLayer)
    this.addChild(this.remoteHandLayer)
    this.addChild(this.handLayer)
    this.deckLayer.visible = false
    this.remoteHandLayer.visible = false
    this.travelLayer.sortableChildren = true
    this.deckLayer.sortableChildren = true
    this.mulliganLayer.sortableChildren = true
    this.handLayer.sortableChildren = true
  }

  async mount(): Promise<void> {
    const human = this.options.route.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )
    const remote = this.options.route.setup.participants.find(
      (participant) => participant.controllerKind === 'ai'
    )
    if (!human || !remote)
      throw new Error('GameScene requires one human and one AI participant.')

    this.localParticipantId = human.participantId
    this.remoteParticipantId = remote.participantId
    this.match = createOpeningMatch(this.options.route.setup, this.options.decks)
    const initialState = this.match.getState()
    this.localPlayerNumber = this.findPlayer(
      initialState,
      this.localParticipantId
    ).playerNumber
    this.remotePlayerNumber = this.findPlayer(
      initialState,
      this.remoteParticipantId
    ).playerNumber

    this.createBoard()
    this.createHeroes(initialState)
    this.createDecks()
    this.createOpeningLayer(initialState)
    this.createMulliganLayer()

    const localPlayer = this.findPlayer(initialState, this.localParticipantId)
    this.localHand.push(...localPlayer.hand.map(cloneCard))
    await this.createInitialLocalCards()

    const aiResult = this.match.dispatch({
      type: 'confirm-mulligan',
      participantId: this.remoteParticipantId,
      replaceInstanceIds: []
    })
    if (!aiResult.accepted) throw new Error(aiResult.message)
    this.remoteBackCount = this.findPlayer(
      aiResult.state,
      this.remoteParticipantId
    ).hand.length
    this.ensureRemoteBacks(this.remoteBackCount)

    this.confirmButton = new Button(this.options.gameAssets.confirmMulliganButton, {
      audio: this.options.audio,
      onClick: () => void this.confirmMulligan()
    })
    this.confirmButton.position.set(
      GAME_SCENE_LAYOUT.confirmButton.x,
      GAME_SCENE_LAYOUT.confirmButton.y
    )
    this.confirmButton.setBaseY(GAME_SCENE_LAYOUT.confirmButton.y)
    this.confirmButton.visible = false
    this.confirmButton.setEnabled(false)
    this.mulliganLayer.addChild(this.confirmButton)
  }

  async playOpeningReveal(): Promise<void> {
    if (this.openingRevealStarted) return
    this.openingRevealStarted = true
    await this.wait(OPENING_TIMING.versusHold)
    await Promise.all([
      ...[...this.heroSprites.entries()].map(([participantId, sprite]) =>
        this.animateHeroToBoard(
          sprite,
          participantId === this.localParticipantId
            ? GAME_SCENE_LAYOUT.localHero
            : GAME_SCENE_LAYOUT.remoteHero
        )
      ),
      this.fadeTo(this.openingLayer, 0, OPENING_TIMING.heroSettle)
    ])
    this.openingLayer.visible = false
    this.deckLayer.visible = true
    this.remoteHandLayer.visible = true
    await this.wait(OPENING_TIMING.boardPause)
    await this.presentMulligan()
  }

  private createBoard(): void {
    const table = new Sprite(this.options.gameAssets.table)
    table.eventMode = 'none'
    this.boardLayer.addChild(table)
    const board = new Sprite(this.options.gameAssets.board)
    board.anchor.set(0.5)
    board.position.set(GAME_SCENE_LAYOUT.board.x, GAME_SCENE_LAYOUT.board.y)
    board.eventMode = 'none'
    this.boardLayer.addChild(board)
  }

  private createHeroes(state: OpeningMatchState): void {
    for (const player of state.players) {
      const texture =
        this.options.heroAssets[
          HERO_CATALOG.require(player.heroId).presentationAssetKey
        ]
      const intro =
        player.participantId === this.localParticipantId
          ? GAME_SCENE_LAYOUT.localIntroHero
          : GAME_SCENE_LAYOUT.remoteIntroHero
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.position.set(intro.x, intro.y)
      sprite.scale.set(intro.scale)
      sprite.eventMode = 'none'
      this.heroSprites.set(player.participantId, sprite)
      this.heroLayer.addChild(sprite)
    }
  }

  private createDecks(): void {
    for (const position of [
      GAME_SCENE_LAYOUT.localDeck,
      GAME_SCENE_LAYOUT.remoteDeck
    ] as const) {
      const deck = new Sprite(this.options.gameAssets.deck)
      deck.anchor.set(0.5)
      deck.position.set(position.x, position.y)
      deck.scale.set(position.scale)
      deck.eventMode = 'none'
      this.deckLayer.addChild(deck)
    }
  }

  private createOpeningLayer(state: OpeningMatchState): void {
    this.openingLayer.addChild(this.createDarkOverlay())

    const versus = new Sprite(this.options.gameAssets.startOfGameVs)
    versus.anchor.set(0.5)
    versus.position.set(960, 540)
    versus.eventMode = 'none'
    this.openingLayer.addChild(versus)
    for (const player of state.players) {
      const hero = HERO_CATALOG.require(player.heroId)
      const intro =
        player.participantId === this.localParticipantId
          ? GAME_SCENE_LAYOUT.localIntroHero
          : GAME_SCENE_LAYOUT.remoteIntroHero
      const label = new Text({
        text: `${hero.displayName}\n${hero.classId.toUpperCase()}`,
        style: {
          fontFamily: 'Belwe',
          fontSize: 34,
          fill: 0xffffff,
          stroke: { color: 0x17120f, width: 6 },
          align: 'center',
          lineHeight: 42
        }
      })
      label.anchor.set(0.5, 0)
      label.position.set(intro.x, intro.y + 265 * intro.scale)
      label.eventMode = 'none'
      this.openingLayer.addChild(label)
    }
  }

  private createMulliganLayer(): void {
    const overlay = this.createDarkOverlay()
    overlay.label = 'mulligan-dark-overlay'
    overlay.alpha = 0
    this.mulliganLayer.addChild(overlay)

    const announcement = new Sprite(this.options.gameAssets.mulliganAnnouncement)
    announcement.anchor.set(0.5, 0)
    announcement.position.set(
      GAME_SCENE_LAYOUT.mulliganAnnouncement.x,
      GAME_SCENE_LAYOUT.mulliganAnnouncement.y
    )
    announcement.label = 'mulligan-announcement'
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.mulliganLayer.addChild(announcement)
  }

  private createDarkOverlay(): Graphics {
    const overlay = new Graphics()
    overlay.rect(0, 0, 1920, 1080)
    overlay.fill({ color: 0x000000, alpha: 0.8 })
    overlay.eventMode = 'none'
    return overlay
  }

  private async createInitialLocalCards(): Promise<void> {
    const slots = await Promise.all(
      this.localHand.map(async (card) => {
        const slot = await this.createSlot(card)
        slot.alpha = 0
        slot.on('pointertap', (event: FederatedPointerEvent) => {
          if (this.confirmationLocked || event.button !== 0) return
          const selected = !this.selectedIds.has(slot.instanceId)
          if (selected) this.selectedIds.add(slot.instanceId)
          else this.selectedIds.delete(slot.instanceId)
          slot.setSelected(selected)
        })
        this.localSlots.set(slot.instanceId, slot)
        this.mulliganLayer.addChild(slot)
        return slot
      })
    )
    this.initialSlots.push(...slots)
  }

  private async createSlot(card: OpeningCard): Promise<GameCardSlot> {
    const view = await CardView.create(cardDefinition(card), this.resolver, {
      artwork: await this.resolver.loadArtwork(card.cardId)
    })
    return new GameCardSlot(
      view,
      card.instanceId,
      this.options.gameAssets.mulliganReplaceCross,
      this.options.gameAssets.mulliganReplacedLabel
    )
  }

  private findPlayer(state: OpeningMatchState, participantId: string) {
    const player = state.players.find(
      (candidate) => candidate.participantId === participantId
    )
    if (!player) throw new Error(`Unknown participant ${participantId}`)
    return player
  }

  private ensureRemoteBacks(count: number): void {
    while (this.remoteBacks.length < count) {
      const back = new Sprite(this.options.gameAssets.cardBack)
      back.anchor.set(0.5, 1)
      back.alpha = 0
      back.eventMode = 'none'
      this.remoteBacks.push(back)
      this.remoteHandLayer.addChild(back)
    }
    this.layoutRemoteHand()
  }

  private layoutRemoteHand(): void {
    const midpoint = (this.remoteBackCount - 1) / 2
    this.remoteBacks.forEach((back, index) => {
      const visible = index < this.remoteBackCount
      back.visible = visible
      if (!visible) return
      back.position.set(
        GAME_SCENE_LAYOUT.remoteHand.centerX +
          (index - midpoint) * GAME_SCENE_LAYOUT.remoteHand.gap,
        GAME_SCENE_LAYOUT.remoteHand.baselineY
      )
      back.rotation = -(index - midpoint) * 0.05
      back.scale.set(GAME_SCENE_LAYOUT.remoteHand.scale)
    })
  }

  private async presentMulligan(): Promise<void> {
    const announcement = this.mulliganLayer.getChildByLabel('mulligan-announcement')
    const overlay = this.mulliganLayer.getChildByLabel('mulligan-dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(overlay, 1, OPENING_TIMING.mulliganFade),
      this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    ])
    const localCommonCount = this.localPlayerNumber === 2 ? 3 : this.initialSlots.length
    const remoteCommonCount = this.remotePlayerNumber === 2 ? 3 : this.remoteBackCount
    await Promise.all([
      this.dealLocalCards(0, localCommonCount),
      this.dealRemoteCards(0, remoteCommonCount)
    ])
    if (this.localPlayerNumber === 2) {
      await this.presentPlayerTwoAnnouncement()
      await this.dealLocalCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    } else {
      await this.dealRemoteCards(3, 4, OPENING_TIMING.playerTwoFourthCard)
    }
    this.confirmButton.visible = true
    this.confirmButton.setEnabled(true)
  }

  private async presentPlayerTwoAnnouncement(): Promise<void> {
    const announcement = new Sprite(this.options.gameAssets.mulliganCoinAnnouncement)
    announcement.anchor.set(0.5)
    announcement.position.set(
      GAME_SCENE_LAYOUT.coinAnnouncement.x,
      GAME_SCENE_LAYOUT.coinAnnouncement.y
    )
    announcement.scale.set(GAME_SCENE_LAYOUT.coinAnnouncement.scale)
    announcement.alpha = 0
    announcement.eventMode = 'none'
    this.mulliganLayer.addChild(announcement)
    await this.fadeTo(announcement, 1, OPENING_TIMING.mulliganFade)
    await this.wait(OPENING_TIMING.playerTwoAnnouncementHold)
    await this.fadeTo(announcement, 0, OPENING_TIMING.playerTwoAnnouncementFade)
    announcement.destroy()
  }

  private async dealLocalCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.initialSlots.slice(start, end).map((slot, offset) => {
        const index = start + offset
        this.prepareSlotAtDeck(slot, GAME_SCENE_LAYOUT.localDeck, index)
        this.travelLayer.addChild(slot)
        return this.animateSlotToMulligan(
          slot,
          index,
          this.initialSlots.length,
          duration,
          offset
        )
      })
    )
  }

  private async dealRemoteCards(
    start: number,
    end: number,
    duration: number = OPENING_TIMING.cardDeal
  ): Promise<void> {
    await Promise.all(
      this.remoteBacks
        .slice(start, Math.min(end, this.remoteBackCount))
        .map((back, offset) => {
          const index = start + offset
          this.prepareBackAtDeck(back, index)
          return this.animateBackToHand(
            back,
            index,
            this.remoteBackCount,
            duration,
            offset
          )
        })
    )
  }

  private async confirmMulligan(): Promise<void> {
    if (this.confirmationLocked) return
    this.confirmationLocked = true
    this.confirmButton.setEnabled(false)
    for (const slot of this.localSlots.values()) slot.eventMode = 'none'
    await this.wait(OPENING_TIMING.confirmationPause)
    const result = this.match.dispatch({
      type: 'confirm-mulligan',
      participantId: this.localParticipantId,
      replaceInstanceIds: [...this.selectedIds]
    })
    if (!result.accepted) {
      this.logger.error(result.message)
      this.confirmationLocked = false
      this.confirmButton.setEnabled(true)
      return
    }
    this.confirmButton.visible = false
    for (const event of result.events) await this.presentEvent(event)
    await this.wait(OPENING_TIMING.handoffPause)
    await this.fadeTo(this.mulliganLayer, 0, OPENING_TIMING.mulliganFade)
    this.mulliganLayer.visible = false
    this.layoutLocalHand()
  }

  private async presentEvent(event: OpeningMatchEvent): Promise<void> {
    switch (event.type) {
      case 'mulligan-resolved':
        if (event.participantId === this.localParticipantId) {
          await this.presentLocalMulligan(event)
        }
        return
      case 'coin-granted':
      case 'opening-card-drawn':
        if (event.participantId === this.localParticipantId) {
          await this.addLocalCard(event.card)
        } else {
          this.remoteBackCount += 1
          this.ensureRemoteBacks(this.remoteBackCount)
          const back = this.remoteBacks[this.remoteBackCount - 1]
          if (back) {
            this.prepareBackAtDeck(back, this.remoteBackCount - 1)
            await this.animateBackToHand(
              back,
              this.remoteBackCount - 1,
              this.remoteBackCount,
              OPENING_TIMING.cardDeal
            )
          }
        }
        await this.wait(OPENING_TIMING.replacementPause)
        return
      case 'opening-turn-started':
        return
    }
  }

  private async presentLocalMulligan(event: MulliganResolvedEvent): Promise<void> {
    const returnedIds = new Set(event.returnedCards.map((card) => card.instanceId))
    const returnedSlots = event.returnedCards
      .map((card) => this.localSlots.get(card.instanceId))
      .filter((slot): slot is GameCardSlot => slot !== undefined)
    await Promise.all(
      returnedSlots.map((slot, index) =>
        this.animateSlotToDeck(slot, GAME_SCENE_LAYOUT.localDeck, index)
      )
    )
    for (const slot of returnedSlots) {
      this.localSlots.delete(slot.instanceId)
      slot.destroy({ children: true })
    }
    await this.wait(OPENING_TIMING.replacementPause)

    const kept = this.localHand.filter((card) => !returnedIds.has(card.instanceId))
    this.localHand.splice(0, this.localHand.length, ...kept)
    const replacementSlots: GameCardSlot[] = []
    for (const card of event.replacementCards) {
      const slot = await this.createSlot(card)
      this.localSlots.set(card.instanceId, slot)
      this.localHand.push(cloneCard(card))
      replacementSlots.push(slot)
    }
    const allSlots = this.localHand
      .map((card) => this.localSlots.get(card.instanceId))
      .filter((slot): slot is GameCardSlot => slot !== undefined)
    allSlots.forEach((slot, index) => {
      slot.setSelected(false)
      slot.eventMode = 'none'
      if (!replacementSlots.includes(slot)) return
      this.prepareSlotAtDeck(slot, GAME_SCENE_LAYOUT.localDeck, index)
      this.travelLayer.addChild(slot)
    })
    await Promise.all(
      allSlots.map((slot, index) =>
        this.animateSlotToMulligan(
          slot,
          index,
          allSlots.length,
          OPENING_TIMING.cardDeal
        )
      )
    )
    for (const slot of allSlots) {
      if (slot.parent !== this.handLayer) this.handLayer.addChild(slot)
      this.configureHandSlot(slot)
    }
    this.localHoveredIndex = null
    await this.animateLocalHandLayout()
    await this.dismissMulliganPresentation()
  }

  private async dismissMulliganPresentation(): Promise<void> {
    const announcement = this.mulliganLayer.getChildByLabel('mulligan-announcement')
    const overlay = this.mulliganLayer.getChildByLabel('mulligan-dark-overlay')
    if (!announcement || !overlay)
      throw new Error('Mulligan presentation is unavailable.')
    await Promise.all([
      this.fadeTo(announcement, 0, OPENING_TIMING.mulliganFade),
      this.fadeTo(overlay, 0, OPENING_TIMING.mulliganFade)
    ])
  }

  private async addLocalCard(card: OpeningCard): Promise<void> {
    if (this.localSlots.has(card.instanceId)) return
    const slot = await this.createSlot(card)
    this.prepareSlotAtDeck(slot, GAME_SCENE_LAYOUT.localDeck, this.localHand.length)
    this.travelLayer.addChild(slot)
    this.localSlots.set(card.instanceId, slot)
    this.localHand.push(cloneCard(card))
    this.localHoveredIndex = null
    const transforms = layoutHand(this.localHand.length, DEFAULT_HAND_LAYOUT)
    await Promise.all(
      this.localHand.map((handCard, index) => {
        const handSlot = this.localSlots.get(handCard.instanceId)
        const target = transforms[index]
        if (!handSlot || !target) return Promise.resolve()
        return this.animateSlotToHand(
          handSlot,
          target,
          handCard.instanceId === card.instanceId ? 0.05 : 0
        )
      })
    )
    this.handLayer.addChild(slot)
    this.configureHandSlot(slot)
  }

  private prepareSlotAtDeck(
    slot: GameCardSlot,
    deck: { readonly x: number; readonly y: number },
    sequence: number
  ): void {
    slot.eventMode = 'none'
    slot.position.set(deck.x, deck.y)
    slot.scale.set(0.08, 0.24)
    slot.skew.set(sequence % 2 === 0 ? 0.3 : -0.3, -0.06)
    slot.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    slot.alpha = 1
  }

  private prepareBackAtDeck(back: Sprite, sequence: number): void {
    back.position.set(GAME_SCENE_LAYOUT.remoteDeck.x, GAME_SCENE_LAYOUT.remoteDeck.y)
    back.scale.set(0.08, 0.12)
    back.rotation = sequence % 2 === 0 ? -0.08 : 0.08
    back.alpha = 1
    back.visible = true
  }

  private animateSlotToMulligan(
    slot: GameCardSlot,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const x =
      GAME_SCENE_LAYOUT.localMulligan.centerX +
      (index - midpoint) * GAME_SCENE_LAYOUT.localMulligan.gap
    const timeline = this.timeline()
    timeline.to(slot, {
      x,
      y: GAME_SCENE_LAYOUT.localMulligan.baselineY,
      rotation: 0,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: GAME_SCENE_LAYOUT.localMulligan.scale,
        y: GAME_SCENE_LAYOUT.localMulligan.scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
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
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    return this.completeTimeline(timeline, () => {
      this.mulliganLayer.addChild(slot)
      slot.eventMode = 'static'
    })
  }

  private animateBackToHand(
    back: Sprite,
    index: number,
    count: number,
    duration: number,
    staggerIndex = index
  ): Promise<void> {
    const midpoint = (count - 1) / 2
    const x =
      GAME_SCENE_LAYOUT.remoteHand.centerX +
      (index - midpoint) * GAME_SCENE_LAYOUT.remoteHand.gap
    const timeline = this.timeline()
    timeline.to(back, {
      x,
      y: GAME_SCENE_LAYOUT.remoteHand.baselineY,
      rotation: -(index - midpoint) * 0.05,
      alpha: 1,
      duration,
      delay: staggerIndex * OPENING_TIMING.cardStagger,
      ease: 'power2.out'
    })
    timeline.to(
      back.scale,
      {
        x: GAME_SCENE_LAYOUT.remoteHand.scale,
        y: GAME_SCENE_LAYOUT.remoteHand.scale,
        duration,
        delay: staggerIndex * OPENING_TIMING.cardStagger,
        ease: 'power2.out'
      },
      0
    )
    return this.completeTimeline(timeline)
  }

  private async animateLocalHandLayout(): Promise<void> {
    const transforms = layoutHand(this.localHand.length, DEFAULT_HAND_LAYOUT)
    await Promise.all(
      this.localHand.map((card, index) => {
        const slot = this.localSlots.get(card.instanceId)
        const target = transforms[index]
        return slot && target
          ? this.animateSlotToHand(slot, target, 0)
          : Promise.resolve()
      })
    )
  }

  private animateSlotToDeck(
    slot: GameCardSlot,
    deck: { readonly x: number; readonly y: number },
    sequence: number
  ): Promise<void> {
    this.travelLayer.addChild(slot)
    slot.eventMode = 'none'
    const direction = slot.x < deck.x ? -1 : 1
    const timeline = this.timeline()
    timeline.to(slot, {
      x: deck.x,
      y: deck.y,
      alpha: 0,
      rotation: direction * (0.16 + sequence * 0.015),
      duration: OPENING_TIMING.cardDeal,
      ease: 'power2.in'
    })
    timeline.to(
      slot.scale,
      {
        x: 0.08,
        y: 0.24,
        duration: OPENING_TIMING.cardDeal,
        ease: 'power2.in'
      },
      0
    )
    return this.completeTimeline(timeline)
  }

  private animateHeroToBoard(
    sprite: Sprite,
    target: { readonly x: number; readonly y: number; readonly scale: number }
  ): Promise<void> {
    const timeline = this.timeline()
    timeline.to(sprite, {
      x: target.x,
      y: target.y,
      duration: OPENING_TIMING.heroSettle,
      ease: 'power2.inOut'
    })
    timeline.to(
      sprite.scale,
      {
        x: target.scale,
        y: target.scale,
        duration: OPENING_TIMING.heroSettle,
        ease: 'power2.inOut'
      },
      0
    )
    return this.completeTimeline(timeline)
  }

  private animateSlotToHand(
    slot: GameCardSlot,
    transform: ReturnType<typeof layoutHand>[number],
    delay: number
  ): Promise<void> {
    const timeline = this.timeline()
    timeline.to(slot, {
      x: transform.x,
      y: transform.y,
      rotation: transform.rotation,
      alpha: 1,
      duration: OPENING_TIMING.cardDeal,
      delay,
      ease: 'power2.out'
    })
    timeline.to(
      slot.scale,
      {
        x: transform.scale,
        y: transform.scale,
        duration: OPENING_TIMING.cardDeal,
        delay,
        ease: 'power2.out'
      },
      0
    )
    timeline.to(
      slot.skew,
      {
        x: 0,
        y: 0,
        duration: OPENING_TIMING.cardDeal,
        delay,
        ease: 'power2.out'
      },
      0
    )
    slot.zIndex = transform.zIndex
    return this.completeTimeline(timeline)
  }

  private configureHandSlot(slot: GameCardSlot): void {
    slot.eventMode = 'static'
    slot.removeAllListeners('pointertap')
    slot.removeAllListeners('pointerover')
    slot.removeAllListeners('pointerout')
    slot.on('pointerover', () => {
      this.localHoveredIndex = this.localHand.findIndex(
        (card) => card.instanceId === slot.instanceId
      )
      this.layoutLocalHand()
    })
    slot.on('pointerout', () => {
      this.localHoveredIndex = null
      this.layoutLocalHand()
    })
  }

  private layoutLocalHand(): void {
    const transforms = layoutHand(
      this.localHand.length,
      DEFAULT_HAND_LAYOUT,
      this.localHoveredIndex
    )
    this.localHand.forEach((card, index) => {
      const slot = this.localSlots.get(card.instanceId)
      const transform = transforms[index]
      if (!slot || !transform) return
      this.tweenTo(slot, {
        x: transform.x,
        y: transform.y,
        rotation: transform.rotation,
        duration: OPENING_TIMING.handSettle,
        ease: 'power2.out'
      })
      this.tweenTo(slot.scale, {
        x: transform.scale,
        y: transform.scale,
        duration: OPENING_TIMING.hover,
        ease: 'power2.out'
      })
      slot.zIndex = transform.zIndex
    })
    this.handLayer.sortableChildren = true
  }

  private fadeTo(
    target: { alpha: number },
    alpha: number,
    duration: number
  ): Promise<void> {
    return this.completeTimeline(
      this.timeline().to(target, { alpha, duration, ease: 'power2.out' })
    )
  }

  private wait(duration: number): Promise<void> {
    return this.completeTimeline(this.timeline().to({}, { duration }))
  }

  private completeTimeline(
    timeline: gsap.core.Timeline,
    onComplete?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      timeline.eventCallback('onComplete', () => {
        onComplete?.()
        resolve()
      })
      timeline.eventCallback('onInterrupt', resolve)
    })
  }
}
