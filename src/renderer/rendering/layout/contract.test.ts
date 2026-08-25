import { Container, Sprite, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { findLayoutLabelViolations, isLayoutLabel, setLayoutLabel } from './contract'

describe('layout label contract', () => {
  it('accepts zone.element labels and rejects legacy labels', () => {
    expect(isLayoutLabel('game.board')).toBe(true)
    expect(isLayoutLabel('collection.card-layer')).toBe(true)
    expect(isLayoutLabel('game-card:123')).toBe(false)
    expect(isLayoutLabel('hero-power')).toBe(false)
  })

  it('reports missing labels and supports validated assignment', () => {
    const root = new Container()
    setLayoutLabel(root, 'scene.root')
    const labelled = new Sprite(Texture.EMPTY)
    setLayoutLabel(labelled, 'scene.background')
    root.addChild(labelled, new Sprite(Texture.EMPTY))

    expect(findLayoutLabelViolations(root)).toHaveLength(1)
    expect(() => setLayoutLabel(root, 'legacy-label')).toThrow(/zone\.element/)
    root.destroy({ children: true })
  })
})
