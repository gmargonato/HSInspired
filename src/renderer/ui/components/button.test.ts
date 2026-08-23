import { ColorMatrixFilter, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { gsap } from '../../animation/animations'
import { Button } from './button'

function finishAnimations(): void {
  for (const animation of gsap.globalTimeline.getChildren()) {
    animation.progress(1)
  }
}

function pointerEvent(button = 0): FederatedPointerEvent {
  return { button } as FederatedPointerEvent
}

describe('Button', () => {
  it('uses the default press scale and zero-pixel sink', () => {
    const button = new Button(Texture.EMPTY)
    button.y = 20
    button.setBaseY(20)
    button.emit('pointerdown', pointerEvent())
    finishAnimations()

    expect(button.sprite.scale.x).toBeCloseTo(0.95)
    expect(button.sprite.scale.y).toBeCloseTo(0.95)
    expect(button.y).toBeCloseTo(20)

    button.dispose()
  })

  it('supports a custom sink and disabling press shrinking', () => {
    const button = new Button(Texture.EMPTY, {
      pressedScale: 1,
      sinkPx: 6
    })
    button.y = 20
    button.setBaseY(20)
    button.emit('pointerdown', pointerEvent())
    finishAnimations()

    expect(button.sprite.scale.x).toBeCloseTo(1)
    expect(button.sprite.scale.y).toBeCloseTo(1)
    expect(button.y).toBeCloseTo(26)

    button.dispose()
  })

  it('can disable hover highlighting while keeping pressed brightness feedback', () => {
    const brightness = vi.spyOn(ColorMatrixFilter.prototype, 'brightness')

    try {
      const highlightedButton = new Button(Texture.EMPTY)
      brightness.mockClear()
      highlightedButton.emit('pointerover', pointerEvent())
      finishAnimations()

      expect(brightness).toHaveBeenCalledWith(1.5, false)
      highlightedButton.dispose()

      const quietButton = new Button(Texture.EMPTY, {
        highlightOnHover: false
      })
      brightness.mockClear()
      quietButton.emit('pointerover', pointerEvent())
      finishAnimations()

      expect(brightness).not.toHaveBeenCalledWith(1.5, false)

      quietButton.emit('pointerdown', pointerEvent())
      finishAnimations()

      expect(brightness).toHaveBeenCalledWith(0.8, false)
      quietButton.dispose()
    } finally {
      brightness.mockRestore()
    }
  })
})
