import { describe, expect, it, vi } from 'vitest'
import { Scene } from '../scenes/scene'
import { SceneManager } from '../scenes/scene-manager'
import { createScene, SceneNavigator } from './scene-navigator'
import { MainMenuScene } from '../scenes/main-menu-scene'
import { DeckSelectionScene } from '../scenes/deck-selection-scene'
import { CollectionScene } from '../scenes/collection-scene'
import { NewDeckScene } from '../scenes/new-deck-scene'
import { GameScene } from '../scenes/game-scene'
import { CardViewScene } from '../scenes/card-view-scene'
import { GameSettingsScene, MenuSettingsScene } from '../scenes/settings-scenes'
import type { AppServices } from './services'
import { SCENE_MENU_ENTRIES } from '../../shared/scene-navigation'
import { asHeroId, CARD_CATALOG } from '../../game/content/cards'
import { asPlayerId } from '../../game/match'

class TestScene extends Scene {
  init(): void {}
  update(): void {}
}

describe('Developer scene navigation', () => {
  it('keeps every native Scenes menu entry connected to a scene factory', () => {
    for (const entry of Object.values(SCENE_MENU_ENTRIES)) {
      expect(createScene(entry.request)).toBeInstanceOf(Scene)
    }
  })
})

describe('Application route transitions', () => {
  function createNavigator(current: Scene | null): {
    navigator: SceneNavigator
    transitionTo: ReturnType<typeof vi.fn>
    push: ReturnType<typeof vi.fn>
    pop: ReturnType<typeof vi.fn>
  } {
    const transitionTo = vi.fn().mockResolvedValue(undefined)
    const push = vi.fn().mockResolvedValue(undefined)
    const pop = vi.fn().mockResolvedValue(undefined)
    const manager = {
      current,
      transitionTo,
      push,
      pop
    } as unknown as SceneManager
    const services = {
      deckStore: {},
      dialogs: { confirm: () => true, error: () => undefined },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    } as unknown as AppServices

    return {
      navigator: new SceneNavigator(manager, services),
      transitionTo,
      push,
      pop
    }
  }

  const gameRoute = {
    id: 'game',
    setup: {
      seed: 7,
      participants: [
        {
          participantId: asPlayerId('human-player'),
          controllerKind: 'human',
          heroId: asHeroId('jaina'),
          deckId: 'human-deck'
        },
        {
          participantId: asPlayerId('ai-player'),
          controllerKind: 'ai',
          heroId: asHeroId('guldan'),
          deckId: 'ai-deck'
        }
      ]
    }
  } as const

  it('restores the chest zoom when a main-menu button has opened the destination', async () => {
    const mainMenu = new MainMenuScene()
    ;(mainMenu as unknown as { transitionOpened: boolean }).transitionOpened = true
    const { navigator, transitionTo } = createNavigator(mainMenu)

    await navigator.navigate({ id: 'deck-selection' })

    const options = transitionTo.mock.calls[0]?.[1]
    expect(options).toMatchObject({
      inset: { x: 415, y: 172.5, width: 1090, height: 735 },
      scaleMode: 'cover',
      duration: 0.45,
      hostParent: mainMenu.destinationTransitionHost,
      hostIndex: 0,
      beforeExpand: expect.any(Function)
    })

    const collectionNavigator = createNavigator(mainMenu)
    await collectionNavigator.navigator.navigate({ id: 'collection' })

    expect(collectionNavigator.transitionTo.mock.calls[0]?.[1]).toMatchObject({
      inset: { x: 415, y: 172.5, width: 1090, height: 735 },
      duration: 0.45,
      hostParent: mainMenu.destinationTransitionHost,
      hostIndex: 0
    })
    expect(collectionNavigator.transitionTo.mock.calls[0]?.[1].afterTransition).toEqual(
      expect.any(Function)
    )
  })

  it('uses the collection fade from deck selection', async () => {
    const { navigator, transitionTo } = createNavigator(
      new DeckSelectionScene({} as never)
    )

    await navigator.navigate({ id: 'collection' })

    expect(transitionTo.mock.calls[0]?.[1]).toMatchObject({
      mode: 'fade',
      duration: 0.6,
      inset: { x: 0, y: 0, width: 1920, height: 1080 }
    })
    expect(transitionTo.mock.calls[0]?.[1].afterTransition).toEqual(
      expect.any(Function)
    )
  })

  it('uses the black fade and opening reveal callback for GameScene', async () => {
    const { navigator, transitionTo } = createNavigator(
      new DeckSelectionScene({} as never)
    )

    await navigator.navigate(gameRoute)

    expect(transitionTo.mock.calls[0]?.[1]).toMatchObject({
      mode: 'fade',
      duration: 0.6,
      inset: { x: 0, y: 0, width: 1920, height: 1080 },
      afterTransition: expect.any(Function)
    })
  })

  it('uses a black fade when returning to deck selection after a match', async () => {
    const { navigator, transitionTo } = createNavigator(
      new GameScene(gameRoute, {} as never)
    )

    await navigator.navigate({ id: 'deck-selection' })

    expect(transitionTo.mock.calls[0]?.[1]).toMatchObject({
      mode: 'fade',
      duration: 0.6,
      inset: { x: 0, y: 0, width: 1920, height: 1080 }
    })
  })

  it('uses the returning main-menu collapse for back navigation and menu requests', async () => {
    const { navigator, transitionTo } = createNavigator(
      new CollectionScene({} as never)
    )

    await navigator.navigateRequest({ id: 'main-menu' })

    expect(transitionTo.mock.calls[0]?.[1]).toMatchObject({
      mode: 'collapse',
      duration: 0.45,
      hostIndex: 0,
      inset: { x: 415, y: 172.5, width: 1090, height: 735 }
    })

    const returningMenu = new MainMenuScene(undefined, 'returning')
    expect(returningMenu.createReturnTransitionOptions()).toMatchObject({
      hostParent: returningMenu.destinationTransitionHost,
      hostIndex: 0
    })
  })

  it('opens menu settings from every menu-flow scene', () => {
    const menuScenes = [
      new MainMenuScene(),
      new DeckSelectionScene({} as never),
      new CollectionScene({} as never),
      new NewDeckScene({} as never)
    ]

    for (const scene of menuScenes) {
      const { navigator, push } = createNavigator(scene)

      expect(navigator.requestSettingsToggle()).toBe(true)
      expect(push).toHaveBeenCalledTimes(1)
      expect(push.mock.calls[0]?.[0]).toBeInstanceOf(MenuSettingsScene)
    }
  })

  it('opens game settings from a match and closes either settings scene', () => {
    const game = new GameScene(gameRoute, {} as never)
    const gameNavigator = createNavigator(game)

    expect(gameNavigator.navigator.requestSettingsToggle()).toBe(true)
    expect(gameNavigator.push.mock.calls[0]?.[0]).toBeInstanceOf(GameSettingsScene)

    for (const settings of [new MenuSettingsScene(), new GameSettingsScene()]) {
      const { navigator, pop } = createNavigator(settings)

      expect(navigator.requestSettingsToggle()).toBe(true)
      expect(pop).toHaveBeenCalledTimes(1)
    }
  })

  it('leaves card previews and unsupported scenes in control of Escape', () => {
    const preview = new CardViewScene({
      card: CARD_CATALOG.require('classic_abomination'),
      sourceBounds: { x: 0, y: 0, width: 310, height: 450 }
    })

    for (const scene of [preview, new TestScene()]) {
      const { navigator, push, pop } = createNavigator(scene)

      expect(navigator.requestSettingsToggle()).toBe(false)
      expect(push).not.toHaveBeenCalled()
      expect(pop).not.toHaveBeenCalled()
    }
  })

  it('coalesces settings toggles while a stack operation is pending', () => {
    const { navigator, push } = createNavigator(new MainMenuScene())
    push.mockReturnValue(new Promise<void>(() => undefined))

    expect(navigator.requestSettingsToggle()).toBe(true)
    expect(navigator.requestSettingsToggle()).toBe(true)
    expect(push).toHaveBeenCalledTimes(1)
  })
})
