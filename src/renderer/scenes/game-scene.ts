import type { AppLogger } from '../app/services'
import type { AppRoute, GameRoute, SceneRouter } from '../app/router'
import type { DeckStore } from '../ui/deck-store'
import type { PlayerStatsStore } from '../ui/player-stats-store'
import type { ArenaStore } from '../ui/arena-store'
import { createMatchSeed } from '../features/deck-selection/deck-selection-model'
import { createRestartGameRoute } from '../features/game/game-route'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type GameAssets
} from '../ui/asset-registry'
import { GameBoardView } from '../features/game/game-board-view'
import type {
  DevCommand,
  DevCardPickerAction,
  DevDeckAction,
  DevMatchTarget
} from '../../shared/dev-menu'
import { Scene } from './scene'
import type { AiDecisionApi } from '../../shared/ipc/ai'
import type { MatchEndedEvent } from '../../game/match'
import { HERO_CATALOG } from '../../game/content/heroes'
import {
  classifyArenaMatchResult,
  shouldRecordClassWin
} from '../features/game/match-win-tracking'
import { GameBoardSession } from '../features/game/game-board-session'
import { AiTurnController } from '../features/game/ai-turn-controller'

/** Full-screen route adapter for the first playable opening sequence. */
export class GameScene extends Scene {
  private readonly deckStore: DeckStore
  private readonly route: GameRoute
  private readonly logger?: AppLogger
  private view: GameBoardView | null = null

  constructor(
    route: GameRoute,
    deckStore: DeckStore,
    private readonly playerStatsStore: PlayerStatsStore,
    private readonly arenaStore: ArenaStore,
    logger?: AppLogger,
    private readonly router?: SceneRouter,
    private readonly ai?: AiDecisionApi
  ) {
    super()
    this.route = route
    this.deckStore = deckStore
    this.logger = logger
  }

  async init(): Promise<void> {
    this.logger?.info('[GameScene] init start', this.route)
    if (!this.route.deckSnapshots) {
      await this.deckStore.load()
      this.logger?.info(
        '[GameScene] deckStore loaded',
        this.deckStore.getDecks().map((d) => d.id)
      )
    }

    const deckCandidates = this.route.deckSnapshots ?? this.deckStore.getDecks()
    const decks = this.route.setup.participants.map((participant) => {
      const deck = deckCandidates.find(
        (candidate) => candidate.id === participant.deckId
      )
      if (!deck)
        throw new Error(`The selected deck ${participant.deckId} is unavailable.`)
      return deck
    })
    this.logger?.info(
      '[GameScene] decks resolved',
      decks.map((d) => `${d.id} — ${d.heroId}`)
    )

    const aiLogger = this.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
    const aiSession = new GameBoardSession({ setup: this.route.setup, decks })
    const aiController = new AiTurnController({
      api: this.ai,
      session: aiSession,
      decks,
      logger: aiLogger
    })
    aiController.prewarmDeckPlan()
    this.logger?.info('[GameScene] AI deck planning started')

    const gameAssets = await this.assetScope.acquire<GameAssets>(ASSET_BUNDLE_IDS.game)
    this.logger?.info('[GameScene] game assets acquired')
    const heroAssets = await this.assetScope.acquire<DeckPresentationAssets>(
      ASSET_BUNDLE_IDS.deckPresentation
    )
    this.logger?.info('[GameScene] hero assets acquired')
    await this.assetScope.acquire(ASSET_BUNDLE_IDS.cardRendering)
    this.logger?.info('[GameScene] card rendering bundle acquired')

    await this.waitForFonts()
    this.logger?.info('[GameScene] fonts ready')

    this.view = new GameBoardView({
      route: this.route,
      decks,
      gameAssets,
      heroAssets,
      renderer: this.appInstance.renderer,
      cursor: this.sceneManager.cursor,
      logger: this.logger,
      ai: this.ai,
      aiRuntime: { session: aiSession, controller: aiController },
      onMatchEnded: (event) => this.recordMatchResult(event),
      onMatchComplete: () => this.router?.navigate(this.createExitRoute())
    })
    this.logger?.info('[GameScene] GameBoardView created')
    try {
      await this.view.mount()
      this.logger?.info('[GameScene] view mounted')
      this.root.addChild(this.view)
      this.logger?.info('[GameScene] view added to root')
    } catch (error) {
      this.logger?.error('[GameScene] view mount failed', error)
      this.view.dispose()
      this.view = null
      throw error
    }
  }

  private async waitForFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return

    const fontLoads = Promise.all([
      document.fonts.load('700 47px Belwe'),
      document.fonts.load('normal 44px "Franklin Gothic Condensed"'),
      document.fonts.load('bold 44px "Franklin Gothic Condensed"')
    ])

    // Fonts are not critical for board visibility; a hanging load (e.g. blocked
    // @font-face, CSP, or missing file) would otherwise leave the fade overlay
    // black forever because SceneManager.fadeImmediate awaits scene.load which
    // awaits this. Race against a short timeout so the match remains playable
    // with fallback fonts and the board is not stuck blank.
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, 2500)
    })

    try {
      await Promise.race([fontLoads, timeout])
      // If the race resolved via timeout, the real loads may still settle later.
      // Swallow their eventual rejection so it does not surface as an unhandled
      // rejection that could be mistaken for a mount failure.
      void fontLoads.catch((error) => {
        this.logger?.warn('[GameScene] font load rejected after timeout', error)
      })
    } catch (error) {
      this.logger?.warn(
        '[GameScene] font loading failed, continuing with fallback',
        error
      )
    }
  }

  private async recordMatchResult(event: MatchEndedEvent): Promise<void> {
    const human = this.route.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )
    if (!human) return

    try {
      if (this.route.mode === 'arena') {
        const result = classifyArenaMatchResult(event, human.participantId)
        if (result) await this.arenaStore.recordResult(result)
        return
      }

      if (!shouldRecordClassWin(event, human.participantId)) return
      if (this.route.mode === 'tavern-brawl') {
        await this.playerStatsStore.recordTavernBrawlWin()
        return
      }

      const classId = HERO_CATALOG.require(human.heroId).classId
      await this.playerStatsStore.recordWin(classId)
    } catch (error) {
      this.logger?.warn('Failed to save the match result.', error)
    }
  }

  update(_deltaMS: number): void {}

  playOpeningReveal(): Promise<void> {
    return this.view?.playOpeningReveal() ?? Promise.resolve()
  }

  concede(): void {
    if (!this.view) throw new Error('Game view is not ready for match actions.')
    this.view.concede()
  }

  createRestartRoute(): GameRoute {
    let seed = createMatchSeed()
    if (this.route.setup.seed !== undefined && seed === this.route.setup.seed) {
      seed = (seed + 1) >>> 0
    }
    return createRestartGameRoute(this.route, seed)
  }

  createExitRoute(): AppRoute {
    return this.route.mode === 'arena'
      ? { id: 'arena' }
      : this.route.mode === 'tavern-brawl'
        ? { id: 'tavern-brawl' }
        : { id: 'deck-selection' }
  }

  openCardPicker(target: DevMatchTarget, action: DevCardPickerAction): void {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    this.view.openCardPicker(target, action)
  }

  async devEndMatch(outcome: 'win' | 'lose'): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devEndMatch(outcome)
  }

  async devModifyDeck(target: DevMatchTarget, action: DevDeckAction): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devModifyDeck(target, action)
  }

  toggleDeckTracker(): void {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    this.view.toggleDeckTracker()
  }

  setDeckTracker(
    visibility: 'hidden' | 'local',
    sortMode: 'cost' | 'alphabetical' | 'draw-order'
  ): void {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    this.view.setDeckTracker(visibility, sortMode)
  }

  async runDevCommand(command: DevCommand): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.runDevCommand(command)
  }

  protected onExit(): void {
    if (!this.view) return
    this.root.removeChild(this.view)
    this.view.dispose()
    this.view = null
  }
}
