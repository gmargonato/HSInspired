import { Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { FlipCard } from './flip-card'

describe('FlipCard', () => {
  it('can start on its back face for reverse scene choreography', () => {
    const card = new FlipCard(Texture.EMPTY, Texture.EMPTY, {
      initialFace: 'back',
      oneShot: true
    })

    expect(card.isFlipped).toBe(true)
    expect(card.front.visible).toBe(false)
    expect(card.back.visible).toBe(true)
    expect(card.eventMode).toBe('none')

    card.dispose()
  })
})
