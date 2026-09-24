import type { AppLogger, DialogService } from '../app/services'
import type { AppRoute, GameRoute, SceneRouter } from '../app/router'
import type { DeckStore } from '../ui/deck-store'
import type { PlayerStatsStore } from '../ui/player-stats-store'
import type { ProgressionStore } from '../ui/progression-store'
import type { ArenaStore } from '../ui/arena-store'
import { createMatchSeed } from '../features/deck-selection/deck-selection-model'
import { createRestartGameRoute } from '../features/game/game-route'
import {
  ASSET_BUNDLE_IDS,
  type DeckPresentationAssets,
  type GameAssets
} from '../ui/asset-registry'
import { GameBoardView } from '../features/game/game-board-view'
import { prebuildMinionOutlineShape } from '../rendering/minions/minion-outline-shape'
import type {
  DevCommand,
  DevCardPickerAction,
  DevDeckAction,
  DevMatchTarget
} from '../../shared/dev-menu'
import { Scene } from './scene'
import type { AiDecisionApi } from '../../shared/ipc/ai'
import type { MatchEndedEvent } from '../../game/match'
import type { ConstructedMatchResult } from '../../game/ranking/constructed-ranking'
import { isArenaRunComplete } from '../../game/arena'
import { HERO_CATALOG } from '../../game/content/heroes'
import {
  classifyArenaMatchResult,
  shouldRecordClassWin
} from '../features/game/match-win-tracking'
import { GameBoardSession } from '../features/game/game-board-session'
import {
  AiTurnController,
  AI_CONVERSATION_LIMITS
} from '../features/game/ai-turn-controller'
import { MatchRecorder, logObject } from '../features/game/match-recorder'
import type { MatchLogsApi } from '../../shared/ipc/match-logs'
import type { PreferencesApi, AiMode } from '../../shared/ipc/preferences'
import { ExpertAiDecisionApi } from '../features/game/expert-ai-decision-api'
import { LocalAiDecisionApi } from '../features/game/local-ai-decision-api'

/** Set true to restore the AI's randomized startup Hero Power bonus. */
const AI_HERO_POWER_BONUS_ENABLED = false

/** Full-screen route adapter for the first playable opening sequence. */
export class GameScene extends Scene {
  private readonly deckStore: DeckStore
  private readonly route: GameRoute
  private readonly logger?: AppLogger
  private view: GameBoardView | null = null
  private expertAiApi: ExpertAiDecisionApi | null = null
  private recorder?: MatchRecorder
  private readonly rewardMatchId = crypto.randomUUID()
  private statisticsAttempted = false
  private opponentLeftShown = false

  constructor(
    route: GameRoute,
    deckStore: DeckStore,
    private readonly playerStatsStore: PlayerStatsStore,
    private readonly arenaStore: ArenaStore,
    logger?: AppLogger,
    private readonly router?: SceneRouter,
    private readonly ai?: AiDecisionApi,
    private readonly matchLogs?: MatchLogsApi,
    private readonly reportLogError: (
      message: string,
      retry?: () => void
    ) => void = console.error,
    private readonly progression?: ProgressionStore,
    private readonly dialogs?: DialogService,
    private readonly preferences?: PreferencesApi
  ) {
    super()
    this.route = route
    this.deckStore = deckStore
    this.logger = logger
  }

  async init(): Promise<void> {
    try {
      await this.initMatch()
    } catch (error) {
      this.recorder?.record('events', 'error', {
        message: 'Match initialization failed.',
        error
      })
      this.recorder?.finish('interrupted')
      throw error
    }
  }

  private async initMatch(): Promise<void> {
    await this.progression?.load()
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

    const aiMode = await this.readAiMode()
    const matchRoute: GameRoute = {
      ...this.route,
      setup: {
        ...this.route.setup,
        aiHeroPowerBonusEnabled: AI_HERO_POWER_BONUS_ENABLED
      }
    }
    this.recorder = new MatchRecorder(
      this.matchLogs,
      logObject({
        mode: this.route.mode ?? 'standard',
        ...(this.route.generatedOpponent
          ? { generatedOpponent: this.route.generatedOpponent }
          : {}),
        aiRuntimeSettings: { ...AI_CONVERSATION_LIMITS },
        aiMode
      }),
      this.reportLogError
    )
    const aiLogger = this.recorder.logger(
      this.logger ?? {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      }
    )
    const aiSession = new GameBoardSession({
      setup: matchRoute.setup,
      decks,
      opponentStrategy: this.route.generatedOpponent?.strategy,
      recorder: this.recorder
    })
    let aiApi: AiDecisionApi | undefined
    if (aiMode === 'hardware') {
      aiApi = new LocalAiDecisionApi(aiSession)
    } else if (aiMode === 'hardware-v2') {
      this.expertAiApi = new ExpertAiDecisionApi(aiSession)
      aiApi = this.expertAiApi
    } else {
      aiApi = this.ai
    }
    const aiController = new AiTurnController({
      api: aiApi,
      session: aiSession,
      logger: aiLogger,
      recorder: this.recorder,
      // Local hardware modes have no transport dependency and remain playable offline.
      ...(aiMode === 'hardware' || aiMode === 'hardware-v2'
        ? { online: () => true }
        : {})
    })

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

    // Building the shared minion outline field is a GPU readback plus a large
    // CPU transform; pay it during load instead of on the first outline in play.
    try {
      prebuildMinionOutlineShape(this.appInstance.renderer)
    } catch (error) {
      // Outlines still build lazily on first use.
      this.logger?.warn('[GameScene] minion outline prebuild failed', error)
    }

    this.view = new GameBoardView({
      route: matchRoute,
      decks,
      gameAssets,
      heroAssets,
      renderer: this.appInstance.renderer,
      cursor: this.sceneManager.cursor,
      logger: aiLogger,
      ai: aiApi,
      aiRuntime: { session: aiSession, controller: aiController },
      onMatchEnded: (event) => this.recordMatchResult(event),
      onMatchComplete: () => this.router?.navigate(this.createExitRoute()),
      onOpponentLeft: () => this.handleOpponentLeft()
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

  private async readAiMode(): Promise<AiMode> {
    const preferences =
      this.preferences ??
      (typeof window !== 'undefined' ? window.api?.preferences : undefined)
    if (!preferences) return 'api'
    try {
      return (await preferences.get()).aiMode
    } catch (error) {
      this.logger?.warn('[GameScene] AI mode preference unavailable; using API.', error)
      return 'api'
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

  private handleOpponentLeft(): void {
    if (this.opponentLeftShown) return
    this.opponentLeftShown = true
    this.dialogs?.abandon('Your opponent left.', () => {
      void this.router?.navigate(this.createExitRoute())
    })
  }

  private async recordMatchResult(event: MatchEndedEvent): Promise<number> {
    const human = this.route.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )
    if (!human) return 0

    if (!this.statisticsAttempted) {
      this.statisticsAttempted = true
      await this.recordStatistics(event)
    }
    const result =
      event.winnerId === null
        ? 'draw'
        : event.winnerId === human.participantId
          ? 'win'
          : 'defeat'
    await this.recordConstructedRank(result)
    if (!this.progression) return 0
    const receipt = await this.progression.reward({
      matchId: this.rewardMatchId,
      mode: this.route.mode ?? 'constructed',
      result,
      reason: event.reason
    })
    return receipt.earned
  }

  /** Arena and Tavern Brawl do not affect the constructed ladder. */
  private async recordConstructedRank(result: ConstructedMatchResult): Promise<void> {
    if (this.route.mode !== undefined) return
    try {
      await this.playerStatsStore.recordConstructedResult({
        matchId: this.rewardMatchId,
        result
      })
    } catch (error) {
      this.logger?.warn('Failed to update the constructed rank.', error)
    }
  }

  private async recordStatistics(event: MatchEndedEvent): Promise<void> {
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

  update(deltaMS: number): void {
    this.view?.updateFrame(deltaMS)
  }

  playOpeningReveal(): Promise<void> {
    return this.view?.playOpeningReveal() ?? Promise.resolve()
  }

  async devConfirmMulligan(): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devConfirmMulligan()
  }

  async devAddCard(cardId: string, target: DevMatchTarget = 'local'): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devAddCard(cardId, target)
  }

  async devSummonMinion(cardId: string, target: DevMatchTarget): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devSummonMinion(cardId, target)
  }

  async devExerciseHandInteraction(): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devExerciseHandInteraction()
  }

  devGetHandInteractionSnapshot(): ReturnType<
    GameBoardView['devGetHandInteractionSnapshot']
  > {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    return this.view.devGetHandInteractionSnapshot()
  }

  async devWaitForPresentationIdle(): Promise<void> {
    if (!this.view) throw new Error('Game view is not ready for dev commands.')
    await this.view.devWaitForPresentationIdle()
  }

  concede(): void {
    if (!this.view) throw new Error('Game view is not ready for match actions.')
    this.view.concede()
  }

  createRestartRoute(): AppRoute {
    const arenaRun = this.arenaStore.getSnapshot()
    if (this.route.mode === 'arena' && arenaRun && isArenaRunComplete(arenaRun)) {
      return { id: 'arena' }
    }
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
    this.recorder?.finish('abandoned')
    this.expertAiApi?.dispose()
    this.expertAiApi = null
    if (!this.view) return
    this.root.removeChild(this.view)
    this.view.dispose()
    this.view = null
  }
}
