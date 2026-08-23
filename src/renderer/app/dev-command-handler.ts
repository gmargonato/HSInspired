import type { SceneManager } from '../scenes/scene-manager'
import type { AppLogger } from './logger'
import type { DevCommand } from '../../shared/dev-menu'
import { CollectionScene } from '../scenes/collection-scene'
import { GameScene } from '../scenes/game-scene'

type DevMenuBridge = {
  onDevCommand?: (listener: (command: DevCommand) => void) => () => void
}

function getDevMenuBridge(): DevMenuBridge | null {
  const api = (window as unknown as { api?: { devMenu?: DevMenuBridge } }).api
  return api?.devMenu ?? null
}

/** Forwards native `Options`/`Dev` menu commands to the current scene. */
export function installDevCommandHandler(
  sceneManager: SceneManager,
  logger: AppLogger
): () => void {
  const bridge = getDevMenuBridge()
  if (!bridge?.onDevCommand) {
    logger.info('[DevMenu] command bridge unavailable')
    return () => undefined
  }

  const handleCommand = (command: DevCommand): void => {
    const current = sceneManager.current
    logger.info('[DevMenu] command received', command, current?.constructor.name)

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

    if (command.type === 'game:open-add-card-picker') {
      if (current instanceof GameScene) {
        try {
          current.openAddCardPicker()
        } catch (error) {
          logger.error('[DevMenu] failed to open add-card picker', error)
        }
        return
      }
      logger.warn('[DevMenu] game add-card picker ignored outside Game', command)
      return
    }

    if (command.type === 'game:add-card') {
      if (current instanceof GameScene) {
        void current.devAddCard(command.cardId).catch((error: unknown) => {
          logger.error('[DevMenu] failed to add card', error)
        })
        return
      }
      logger.warn('[DevMenu] game add-card ignored outside Game', command)
      return
    }

    if (command.type === 'game:set-mana') {
      if (current instanceof GameScene) {
        void current
          .devSetMana(command.available, command.maximum)
          .catch((error: unknown) => {
            logger.error('[DevMenu] failed to set mana', error)
          })
        return
      }
      logger.warn('[DevMenu] game set-mana ignored outside Game', command)
      return
    }

    if (command.type === 'game:toggle-tracker') {
      if (current instanceof GameScene) {
        try {
          current.toggleDeckTracker()
          logger.info('[DevMenu] game tracker toggled')
        } catch (error) {
          logger.error('[DevMenu] failed to toggle tracker', error)
        }
        return
      }
      logger.warn('[DevMenu] game command ignored outside Game', command)
      return
    }
  }

  return bridge.onDevCommand(handleCommand)
}
