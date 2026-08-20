import { Container } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { Application } from 'pixi.js'
import { Scene } from '../src/renderer/src/scenes/Scene'
import { SceneManager } from '../src/renderer/src/scenes/SceneManager'
import { calculateTransitionScale } from '../src/renderer/src/scenes/transitions/SceneTransitionHost'
import { createScene, SceneNavigator } from '../src/renderer/src/app/SceneNavigator'
import { MainMenuScene } from '../src/renderer/src/scenes/MainMenuScene'
import { DeckSelectionScene } from '../src/renderer/src/scenes/DeckSelectionScene'
import { CollectionScene } from '../src/renderer/src/scenes/CollectionScene'
import type { AppServices } from '../src/renderer/src/app/services'
import { SCENE_MENU_ENTRIES } from '../src/shared/sceneNavigation'

class TestScene extends Scene {
  readonly events: string[] = []
  updates = 0

  constructor(private readonly shouldFail = false) {
    super()
  }

  init(): void {
    this.events.push('init')
    if (this.shouldFail) throw new Error('scene failed')
  }

  update(): void {
    this.updates += 1
  }

  protected onEnter(): void {
    this.events.push('enter')
  }

  protected onExit(): void {
    this.events.push('exit')
  }

  protected onPause(): void {
    this.events.push('pause')
  }

  protected onResume(): void {
    this.events.push('resume')
  }
}

function createApplication(): Application {
  return {
    stage: new Container(),
    screen: { width: 1920, height: 1080 },
    ticker: {
      add: vi.fn(),
      remove: vi.fn(),
      deltaMS: 16
    }
  } as unknown as Application
}

describe('Scene lifecycle', () => {
  it('loads, pauses, resumes, ticks, and unloads deterministically', async () => {
    const scene = new TestScene()
    const app = createApplication()

    await scene.load(app)
    scene.tick(16)
    scene.pause()
    scene.tick(16)
    scene.resume()
    scene.tick(16)
    await scene.unload()

    expect(scene.updates).toBe(2)
    expect(scene.events).toEqual(['init', 'enter', 'pause', 'resume', 'exit'])
    expect(scene.state).toBe('unloaded')
  })

  it('cleans up a scene that fails during loading', async () => {
    const scene = new TestScene(true)

    await expect(scene.load(createApplication())).rejects.toThrow('scene failed')
    expect(scene.state).toBe('failed')

    await scene.unload()
    expect(scene.state).toBe('unloaded')
  })
})

describe('SceneManager transitions', () => {
  it('rolls back a failed push and resumes the previous scene', async () => {
    const app = createApplication()
    const manager = new SceneManager(app)
    const first = new TestScene()
    const failed = new TestScene(true)

    await manager.start(first)
    await expect(manager.push(failed)).rejects.toThrow('scene failed')

    expect(manager.current).toBe(first)
    expect(first.state).toBe('active')
    expect(first.events).toContain('pause')
    expect(first.events).toContain('resume')

    await manager.stop()
    expect(first.state).toBe('unloaded')
    expect(app.ticker.remove).toHaveBeenCalled()
  })

  it('serializes pushes and pops in stack order', async () => {
    const manager = new SceneManager(createApplication())
    const first = new TestScene()
    const second = new TestScene()

    await manager.start(first)
    await Promise.all([manager.push(second), manager.pop()])

    expect(manager.current).toBe(first)
    expect(first.state).toBe('active')
    expect(second.state).toBe('unloaded')
  })

  it('promotes a transition destination after the presentation completes', async () => {
    const manager = new SceneManager(createApplication())
    const first = new TestScene()
    const second = new TestScene()
    let callbackRanWhileBothScenesWereActive = false

    await manager.start(first)
    await manager.transitionTo(second, {
      inset: { x: 415, y: 172.5, width: 1090, height: 735 },
      duration: 0,
      beforeExpand: () => {
        callbackRanWhileBothScenesWereActive =
          first.state === 'active' && second.state === 'active'
      }
    })

    expect(callbackRanWhileBothScenesWereActive).toBe(true)
    expect(manager.current).toBe(second)
    expect(first.state).toBe('unloaded')
    expect(second.state).toBe('active')

    await manager.stop()
  })

  it('keeps the outgoing scene in the inset until collapse choreography finishes', async () => {
    const manager = new SceneManager(createApplication())
    const first = new TestScene()
    const second = new TestScene()
    const events: string[] = []

    await manager.start(first)
    await manager.transitionTo(second, {
      inset: { x: 415, y: 172.5, width: 1090, height: 735 },
      mode: 'collapse',
      duration: 0,
      hostParent: second.root,
      hostIndex: 0,
      afterCollapse: (host) => {
        events.push('collapsed')
        expect(host.parent).toBe(second.root)
        expect(host.sceneRoot).toBe(first.root)
        expect(manager.current).toBe(first)
        expect(first.state).toBe('active')
        expect(second.state).toBe('active')
      },
      afterTransition: () => {
        events.push('committed')
        expect(manager.current).toBe(second)
        expect(first.state).toBe('unloaded')
      }
    })

    expect(events).toEqual(['collapsed', 'committed'])
    expect(manager.current).toBe(second)

    await manager.stop()
  })

  it('restores the outgoing scene when collapse choreography fails', async () => {
    const manager = new SceneManager(createApplication())
    const first = new TestScene()
    const second = new TestScene()
    first.root.eventMode = 'static'

    await manager.start(first)
    const originalParent = first.root.parent

    await expect(
      manager.transitionTo(second, {
        inset: { x: 415, y: 172.5, width: 1090, height: 735 },
        mode: 'collapse',
        duration: 0,
        hostParent: second.root,
        hostIndex: 0,
        afterCollapse: () => {
          throw new Error('collapse failed')
        }
      })
    ).rejects.toThrow('collapse failed')

    expect(manager.current).toBe(first)
    expect(first.state).toBe('active')
    expect(first.root.parent).toBe(originalParent)
    expect(first.root.eventMode).toBe('static')
    expect(second.state).toBe('unloaded')

    await manager.stop()
  })

  it('uses cover and contain scales for inset scene presentation', () => {
    const inset = { x: 415, y: 172.5, width: 1090, height: 735 }

    expect(calculateTransitionScale(inset, 'cover')).toBeCloseTo(735 / 1080)
    expect(calculateTransitionScale(inset, 'contain')).toBeCloseTo(1090 / 1920)
  })

  it('rolls back a failed transition without pausing the source scene', async () => {
    const manager = new SceneManager(createApplication())
    const first = new TestScene()
    const second = new TestScene()

    await manager.start(first)
    await expect(
      manager.transitionTo(second, {
        inset: { x: 415, y: 172.5, width: 1090, height: 735 },
        duration: 0,
        beforeExpand: () => {
          throw new Error('transition failed')
        }
      })
    ).rejects.toThrow('transition failed')

    expect(manager.current).toBe(first)
    expect(first.state).toBe('active')
    expect(second.state).toBe('unloaded')
    expect(first.events).not.toContain('pause')

    await manager.stop()
  })

  it('keeps the destination committed when its reveal callback fails', async () => {
    const manager = new SceneManager(createApplication())
    const first = new TestScene()
    const second = new TestScene()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await manager.start(first)
      await expect(
        manager.transitionTo(second, {
          inset: { x: 0, y: 0, width: 1920, height: 1080 },
          duration: 0,
          afterTransition: () => {
            throw new Error('reveal failed')
          }
        })
      ).resolves.toBeUndefined()

      expect(manager.current).toBe(second)
      expect(first.state).toBe('unloaded')
      expect(second.state).toBe('active')

      await manager.stop()
    } finally {
      consoleError.mockRestore()
    }
  })
})

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
  } {
    const transitionTo = vi.fn().mockResolvedValue(undefined)
    const manager = {
      current,
      transitionTo,
      push: vi.fn().mockResolvedValue(undefined)
    } as unknown as SceneManager
    const services = {
      audio: {},
      deckStore: {},
      dialogs: { confirm: () => true, error: () => undefined },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    } as unknown as AppServices

    return { navigator: new SceneNavigator(manager, services), transitionTo }
  }

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
      hostParent: mainMenu.root,
      hostIndex: 2,
      beforeExpand: expect.any(Function)
    })

    const collectionNavigator = createNavigator(mainMenu)
    await collectionNavigator.navigator.navigate({ id: 'collection' })

    expect(collectionNavigator.transitionTo.mock.calls[0]?.[1]).toMatchObject({
      inset: { x: 415, y: 172.5, width: 1090, height: 735 },
      duration: 0.45,
      hostParent: mainMenu.root,
      hostIndex: 2
    })
    expect(collectionNavigator.transitionTo.mock.calls[0]?.[1].afterTransition).toEqual(
      expect.any(Function)
    )
  })

  it('uses the collection fade from deck selection', async () => {
    const { navigator, transitionTo } = createNavigator(new DeckSelectionScene())

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

  it('uses the returning main-menu collapse for back navigation and menu requests', async () => {
    const { navigator, transitionTo } = createNavigator(
      new CollectionScene({} as never)
    )

    await navigator.navigateRequest({ id: 'main-menu' })

    expect(transitionTo.mock.calls[0]?.[1]).toMatchObject({
      mode: 'collapse',
      duration: 0.45,
      hostIndex: 2,
      inset: { x: 415, y: 172.5, width: 1090, height: 735 }
    })
  })
})
