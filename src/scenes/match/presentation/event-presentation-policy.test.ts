import { gsap } from 'gsap'
import { Texture } from 'pixi.js'
import { MISSILE_VFX_TIMING } from '../../../visual-components/effects/missile-vfx-shader'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { HERO_POWER_CATALOG } from '../../../game-rules/content/hero-powers'
import {
  getVfxTemplateLibrary,
  validateVfxReferences
} from '../../../visual-components/effects/vfx-templates'
import { MatchVfxPresenter, matchVfxAreas } from './match-vfx-presenter'
import { describe, expect, it, vi } from 'vitest'
import { EVENT_PRESENTATION_POLICY } from './event-presentation-policy'

describe('event presentation policy', () => {
  it('assigns an intentional policy to every public event', () => {
    expect(Object.values(EVENT_PRESENTATION_POLICY)).not.toContain(undefined)
  })

  it('presents character healing as an animation', () => {
    expect(EVENT_PRESENTATION_POLICY['character-healed']).toBe('animation')
  })
})

describe('authored VFX library', () => {
  it('resolves all authored card, generated card and hero-power references', () => {
    const library = getVfxTemplateLibrary()
    expect(() =>
      validateVfxReferences([CARD_CATALOG.all, HERO_POWER_CATALOG.all], library)
    ).not.toThrow()
    expect(() =>
      validateVfxReferences({ effects: [{ vfx: 'missing-effect' }] }, library)
    ).toThrow('Unknown authored VFX')
    expect(() =>
      validateVfxReferences({ effects: [{ action: 'damage' }] }, library)
    ).not.toThrow()
  })

  it('maps explicit board and hero coverage for both player orientations', () => {
    expect(matchVfxAreas(['enemyBoard', 'enemyHero'], true)).toEqual([
      'remoteBoard',
      'remoteHero'
    ])
    expect(matchVfxAreas(['enemyBoard', 'enemyHero'], false)).toEqual([
      'localBoard',
      'localHero'
    ])
    expect(
      matchVfxAreas(['friendlyBoard', 'enemyBoard', 'friendlyHero', 'enemyHero'], false)
    ).toEqual(['bothBoards', 'remoteHero', 'localHero'])
  })
})

describe('missile presentation lifecycle', () => {
  it('releases the queue at impact and cleans the trail at completion', async () => {
    const timeline = gsap.timeline({ paused: true })
    const presenter = new MatchVfxPresenter(
      { burnNoise: Texture.EMPTY, playSpotlight1: Texture.EMPTY },
      () => timeline
    )
    const visual = { update: vi.fn(), dispose: vi.fn() }
    vi.spyOn(
      presenter as unknown as { makeMissile(): typeof visual },
      'makeMissile'
    ).mockReturnValue(visual)
    const template = getVfxTemplateLibrary().templates.find(
      (t) => t.id === 'fire-missile'
    )!
    const resolved = vi.fn()
    const playing = presenter
      .play(template, true, { x: 0, y: 0 }, { x: 100, y: 100 })
      .then(resolved)
    timeline.progress(MISSILE_VFX_TIMING.arrival - 0.01, false)
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()
    timeline.progress(MISSILE_VFX_TIMING.arrival + 0.01, false)
    await playing
    expect(resolved).toHaveBeenCalledOnce()
    expect(visual.dispose).not.toHaveBeenCalled()
    timeline.progress(1, false)
    expect(visual.dispose).toHaveBeenCalledOnce()
    presenter.dispose()
    expect(visual.dispose).toHaveBeenCalledOnce()
  })

  it('releases a waiting queue when disposed before impact', async () => {
    const timeline = gsap.timeline({ paused: true })
    const presenter = new MatchVfxPresenter(
      { burnNoise: Texture.EMPTY, playSpotlight1: Texture.EMPTY },
      () => timeline
    )
    const visual = { update: vi.fn(), dispose: vi.fn() }
    vi.spyOn(
      presenter as unknown as { makeMissile(): typeof visual },
      'makeMissile'
    ).mockReturnValue(visual)
    const template = getVfxTemplateLibrary().templates.find(
      (t) => t.id === 'fire-missile'
    )!
    const playing = presenter.play(template, true, { x: 0, y: 0 }, { x: 100, y: 100 })
    presenter.dispose()
    await playing
    expect(visual.dispose).toHaveBeenCalledOnce()
  })
})
