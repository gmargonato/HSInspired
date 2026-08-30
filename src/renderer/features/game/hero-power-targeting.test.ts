import { Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../rendering/effects/animated-outline', () => ({
  AnimatedOutline: class {
    setEnabled(): void {}
    dispose(): void {}
  }
}))

import { isLegalHeroPowerTarget } from './hero-power-targeting'
import { HeroPowerView } from './hero-power-view'

describe('hero-power target presentation', () => {
  const remote = 'remote' as never

  it('uses domain targets rather than a static hero-power targeting definition', () => {
    const legalTargets = [
      { kind: 'minion' as const, participantId: remote, instanceId: 'enemy-minion' }
    ]

    expect(
      isLegalHeroPowerTarget(legalTargets, {
        kind: 'minion',
        participantId: remote,
        instanceId: 'enemy-minion'
      })
    ).toBe(true)
    expect(
      isLegalHeroPowerTarget(legalTargets, { kind: 'hero', participantId: remote })
    ).toBe(false)
  })

  it('recognizes legal targets on either side of the board', () => {
    const local = 'local' as never
    const legalTargets = [
      { kind: 'hero' as const, participantId: local },
      { kind: 'minion' as const, participantId: remote, instanceId: 'enemy-minion' }
    ]

    expect(
      isLegalHeroPowerTarget(legalTargets, { kind: 'hero', participantId: local })
    ).toBe(true)
    expect(
      isLegalHeroPowerTarget(legalTargets, {
        kind: 'minion',
        participantId: remote,
        instanceId: 'enemy-minion'
      })
    ).toBe(true)
  })

  it('consumes the activation tap before it can bubble into board cancellation', () => {
    const onClick = vi.fn()
    const stopPropagation = vi.fn()
    const view = new HeroPowerView({
      layout: {
        card: {
          position: { x: 100, y: 100 },
          size: { width: 150, height: 150 },
          anchor: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 }
        },
        crystalOffset: { x: 0, y: 0 },
        costOffset: { x: 0, y: 0 }
      },
      backTexture: Texture.EMPTY,
      frontTexture: Texture.EMPTY,
      manaTexture: Texture.EMPTY,
      cost: 2,
      onClick
    })
    view.setEnabled(true)

    const event = { button: 0, pointerId: 4, stopPropagation }
    view.emit('pointertap', event as never)

    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledWith(event)
    view.dispose()
  })

  it('starts a drag gesture without letting pointerdown reach the board', () => {
    const onPointerDown = vi.fn()
    const stopPropagation = vi.fn()
    const view = new HeroPowerView({
      layout: {
        card: {
          position: { x: 100, y: 100 },
          size: { width: 150, height: 150 },
          anchor: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 }
        },
        crystalOffset: { x: 0, y: 0 },
        costOffset: { x: 0, y: 0 }
      },
      backTexture: Texture.EMPTY,
      frontTexture: Texture.EMPTY,
      manaTexture: Texture.EMPTY,
      cost: 2,
      onClick: vi.fn(),
      onPointerDown
    })
    view.setEnabled(true)

    view.emit('pointerdown', {
      button: 0,
      pointerId: 4,
      stopPropagation
    } as never)

    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onPointerDown).toHaveBeenCalledOnce()
    view.dispose()
  })
})
