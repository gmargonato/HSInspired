import { Container } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { Application } from 'pixi.js'
import { Scene } from './scene'

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
