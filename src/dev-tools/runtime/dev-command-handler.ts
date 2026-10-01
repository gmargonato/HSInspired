import type { SceneManager } from '../../application/navigation/scene-manager'
import type { AppLogger } from '../../application/logger'
import type { DevCommand, PremiumMode } from '../../desktop/contracts/dev-menu'
import type { ProgressionStore } from '../../application/contracts/progression-store'
import type { PlayerStatsStore } from '../../application/contracts/player-stats-store'
import { requestDevDustAmount } from './dev-dust-dialog'
import { CollectionScene } from '../../scenes/collection/collection-scene'
import { GameScene } from '../../scenes/match/game-scene'
import { ArenaScene } from '../../scenes/arena/arena-scene'
import { DeckSelectionScene } from '../../scenes/deck-selection/deck-selection-scene'
import { MainMenuScene } from '../../scenes/main-menu/main-menu-scene'
import { createSeasonKey } from '../../game-rules/ranking/constructed-ranking'
import type { ConstructedRankSnapshot } from '../../desktop/contracts/ipc/player-stats'
import {
  getPremiumMode,
  setPremiumMode,
  subscribeToPremiumAppearance
} from '../../visual-components/cards/premium-appearance'

type DevMenuBridge = {
  notifyPremiumMode?: (mode: PremiumMode) => void
  onDevCommand?: (listener: (command: DevCommand) => void) => () => void
}

function getDevMenuBridge(): DevMenuBridge | null {
  const api = (window as unknown as { api?: { devMenu?: DevMenuBridge } }).api
  return api?.devMenu ?? null
}

/** Forwards native `Options`/`Dev` menu commands to the current scene. */
export function installDevCommandHandler(
  sceneManager: SceneManager,
  logger: AppLogger,
  progression: ProgressionStore,
  playerStats: PlayerStatsStore,
  reportError: (message: string) => void = console.error
): () => void {
  const bridge = getDevMenuBridge()
  if (!bridge?.onDevCommand) {
    return () => undefined
  }

  let dustCommandPending = false
  let rankCommandPending = false
  const handleCommand = (command: DevCommand): void => {
    if (command.type === 'progression:set-dust') {
      if (dustCommandPending) return
      dustCommandPending = true
      void (async () => {
        await progression.load()
        const amount =
          command.amount === 'custom'
            ? await requestDevDustAmount(progression.getSnapshot().dust)
            : command.amount
        if (amount !== null) await progression.setDust(amount)
      })()
        .catch((error) => {
          logger.error('[DevMenu] failed to set Arcane Dust', error)
          reportError('Could not save the Arcane Dust balance. Please try again.')
        })
        .finally(() => {
          dustCommandPending = false
        })
      return
    }
    if (command.type === 'ranking:set-rank') {
      if (rankCommandPending) return
      rankCommandPending = true
      const rank: ConstructedRankSnapshot =
        command.tier === 'legend'
          ? {
              tier: 'legend',
              legendRank: command.rank,
              seasonKey: createSeasonKey(new Date())
            }
          : {
              tier: 'rank',
              rank: command.rank,
              seasonKey: createSeasonKey(new Date())
            }
      void (async () => {
        if (!playerStats.devSetRank) {
          throw new Error('Rank overrides are only available in development')
        }
        await playerStats.load()
        await playerStats.devSetRank(rank)
        if (sceneManager.current instanceof DeckSelectionScene) {
          sceneManager.current.refreshRank()
        }
      })()
        .catch((error) => {
          logger.error('[DevMenu] failed to set the constructed rank', error)
          reportError('Could not set the rank. Please try again.')
        })
        .finally(() => {
          rankCommandPending = false
        })
      return
    }
    if (command.type === 'ranking:reset-season') {
      if (rankCommandPending || !(sceneManager.current instanceof MainMenuScene)) return
      rankCommandPending = true
      void sceneManager.current
        .devResetSeason()
        .catch((error) => {
          logger.error('[DevMenu] failed to reset the constructed season', error)
          reportError('Could not reset the season. Please try again.')
        })
        .finally(() => {
          rankCommandPending = false
        })
      return
    }
    if (command.type === 'cards:set-premium') {
      setPremiumMode(command.mode)
      return
    }
    const current = sceneManager.current
    if (command.type === 'arena:retire' || command.type === 'arena:set-score') {
      if (current instanceof ArenaScene) {
        void current.runDevCommand(command).catch((error: unknown) => {
          logger.error('[DevMenu] failed to update Arena', error)
          reportError('Could not update the Arena run. Please try again.')
        })
      }
      return
    }

    if (command.type === 'collection:set-collectible') {
      if (current instanceof CollectionScene) {
        void current.setCollectibleMode(command.mode).catch((error: unknown) => {
          logger.error('[DevMenu] failed to set collectible mode', error)
        })
        return
      }
      logger.warn('[DevMenu] collection command ignored outside Collection', command)
      return
    }

    if (command.type === 'game:open-card-picker') {
      if (current instanceof GameScene) {
        try {
          current.openCardPicker(command.target, command.action)
        } catch (error) {
          logger.error('[DevMenu] failed to open add-card picker', error)
        }
        return
      }
      logger.warn('[DevMenu] game add-card picker ignored outside Game', command)
      return
    }

    if (command.type === 'game:end-match') {
      if (current instanceof GameScene) {
        void current.devEndMatch(command.outcome).catch((error: unknown) => {
          logger.error('[DevMenu] failed to end match', error)
        })
        return
      }
      logger.warn('[DevMenu] game end-match ignored outside Game', command)
      return
    }

    if (command.type === 'game:modify-deck') {
      if (current instanceof GameScene) {
        void current
          .devModifyDeck(command.target, command.action)
          .catch((error: unknown) => {
            logger.error('[DevMenu] failed to modify deck', error)
          })
        return
      }
      logger.warn('[DevMenu] game deck command ignored outside Game', command)
      return
    }

    if (command.type === 'game:set-mana') {
      if (current instanceof GameScene) {
        void current.runDevCommand(command).catch((error: unknown) => {
          logger.error('[DevMenu] failed to set mana', error)
        })
        return
      }
      logger.warn('[DevMenu] game set-mana ignored outside Game', command)
      return
    }

    if (
      command.type === 'game:set-hero' ||
      command.type === 'game:draw' ||
      command.type === 'game:set-hero-power' ||
      command.type === 'game:set-fatigue' ||
      command.type === 'game:clear-zone' ||
      command.type === 'game:remove-weapon'
    ) {
      if (current instanceof GameScene) {
        void current.runDevCommand(command).catch((error: unknown) => {
          logger.error('[DevMenu] failed to update game state', error)
        })
        return
      }
      logger.warn('[DevMenu] game state command ignored outside Game', command)
      return
    }

    if (command.type === 'game:toggle-tracker') {
      if (current instanceof GameScene) {
        try {
          current.toggleDeckTracker()
        } catch (error) {
          logger.error('[DevMenu] failed to toggle tracker', error)
        }
        return
      }
      logger.warn('[DevMenu] game command ignored outside Game', command)
      return
    }

    if (command.type === 'game:set-deck-tracker') {
      if (current instanceof GameScene) {
        try {
          current.setDeckTracker(command.visibility, command.sortMode)
        } catch (error) {
          logger.error('[DevMenu] failed to configure deck tracker', error)
        }
        return
      }
      logger.warn('[DevMenu] deck tracker command ignored outside Game', command)
    }
  }

  const unsubscribeCommands = bridge.onDevCommand(handleCommand)
  const unsubscribePremium = subscribeToPremiumAppearance((mode) =>
    bridge.notifyPremiumMode?.(mode)
  )
  bridge.notifyPremiumMode?.(getPremiumMode())
  return () => {
    unsubscribeCommands()
    unsubscribePremium()
  }
}
