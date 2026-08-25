import { Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { HeroView } from '../../rendering/heroes/hero-view'
import { MatchResultOverlay } from './match-result-overlay'

describe('MatchResultOverlay', () => {
  it('shows the selected result above the promoted local hero', () => {
    const overlay = new MatchResultOverlay({
      winScreen: Texture.WHITE,
      defeatScreen: Texture.EMPTY,
      onContinue: vi.fn()
    })
    const hero = HeroView.create(
      { label: 'game.hero.local', attack: 0, health: 0, maxHealth: 30 },
      { frame: Texture.EMPTY, attack: Texture.EMPTY, health: Texture.EMPTY }
    )

    overlay.show('win', hero)

    expect(overlay.children[0]).toMatchObject({ texture: Texture.WHITE })

    overlay.show('defeat', hero)

    expect(overlay.visible).toBe(true)
    expect(overlay.children[0]).toMatchObject({ texture: Texture.EMPTY })
    expect(hero.parent?.label).toBe('game.match-result.hero-layer')
    expect(hero.label).toBe('game.match-result.hero')
    expect(hero.position).toMatchObject({ x: 960, y: 485 })
    hero.destroy({ children: true })
    overlay.destroy({ children: true })
  })

  it('renders the required continuation prompt', () => {
    const overlay = new MatchResultOverlay({
      winScreen: Texture.EMPTY,
      defeatScreen: Texture.EMPTY,
      onContinue: vi.fn()
    })
    const prompt = overlay.children.find(
      (child) => child.label === 'game.match-result.continue-prompt'
    )

    expect(prompt).toMatchObject({ text: 'Click to continue' })
    expect(overlay.label).toBe('game.match-result')
    expect(overlay.hitArea).toMatchObject({ width: 1920, height: 1080 })
    overlay.destroy({ children: true })
  })
})
