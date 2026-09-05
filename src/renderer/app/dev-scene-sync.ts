import type { SceneManager } from '../scenes/scene-manager'
import { MainMenuScene } from '../scenes/main-menu-scene'
import { DeckSelectionScene } from '../scenes/deck-selection-scene'
import { CollectionScene } from '../scenes/collection-scene'
import { NewDeckScene } from '../scenes/new-deck-scene'
import { GameScene } from '../scenes/game-scene'
import { TavernBrawlScene } from '../scenes/tavern-brawl-scene'
import { ArenaScene } from '../scenes/arena-scene'
import { GameSettingsScene, MenuSettingsScene } from '../scenes/settings-scenes'
import { CardViewScene } from '../scenes/card-view-scene'
import type { DevSceneId } from '../../shared/dev-menu'
import type { AppLogger } from './logger'

type DevMenuBridge = {
  notifySceneChanged?: (sceneId: DevSceneId) => void
}

function getDevMenuBridge(): DevMenuBridge | null {
  const api = (window as unknown as { api?: { devMenu?: DevMenuBridge } }).api
  return api?.devMenu ?? null
}

function getDevSceneId(scene: unknown): DevSceneId {
  const devSceneId = (scene as { readonly devSceneId?: unknown } | null)?.devSceneId
  if (devSceneId === 'card-inspector' || devSceneId === 'outline-lab') return devSceneId
  if (scene instanceof MainMenuScene) return 'main-menu'
  if (scene instanceof DeckSelectionScene) return 'deck-selection'
  if (scene instanceof CollectionScene) return 'collection'
  if (scene instanceof NewDeckScene) return 'new-deck'
  if (scene instanceof TavernBrawlScene) return 'tavern-brawl'
  if (scene instanceof ArenaScene) return 'arena'
  if (scene instanceof GameScene) return 'game'
  if (scene instanceof MenuSettingsScene || scene instanceof GameSettingsScene)
    return 'settings'
  if (scene instanceof CardViewScene) return 'card-preview'
  return 'unknown'
}

/**
 * Notifies the main process of the current scene so the native `Options`
 * menu can enable only relevant items. No-op when the bridge is unavailable.
 */
export function installDevSceneSync(
  sceneManager: SceneManager,
  logger: AppLogger
): () => void {
  const bridge = getDevMenuBridge()
  const notifySceneChanged = bridge?.notifySceneChanged
  if (!notifySceneChanged) {
    return () => undefined
  }

  let lastSceneId: DevSceneId | null = null
  const sync = (): void => {
    const sceneId = getDevSceneId(sceneManager.current)
    if (sceneId === lastSceneId) return
    lastSceneId = sceneId
    try {
      notifySceneChanged(sceneId)
    } catch (error) {
      logger.warn('[DevMenu] failed to notify scene', error)
    }
  }

  // Immediate sync for the initial scene
  sync()
  const unsubscribe = sceneManager.subscribe(sync)
  return () => unsubscribe()
}
