import { Container } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { Application } from 'pixi.js'
import { Scene } from './scene'
import { SceneManager } from './scene-manager'
import { calculateTransitionScale } from './transitions/scene-transition-host'

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
