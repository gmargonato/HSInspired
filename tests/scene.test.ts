import { Container } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { Application } from 'pixi.js'
import { Scene } from '../src/renderer/src/scenes/Scene'
import { SceneManager } from '../src/renderer/src/core/SceneManager'

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
})
