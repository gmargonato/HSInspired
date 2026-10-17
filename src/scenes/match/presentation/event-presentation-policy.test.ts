import { gsap } from 'gsap'
import { Texture } from 'pixi.js'
import { FIREBALL_LAYOUT } from '../../../visual-components/effects/fireball-layout'
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
  it.each([
    'fire-missile',
    'fire-missile-small',
    'fire-missile-large',
    'shadow-missile-small',
    'arcane-missile-small',
    'frost-missile-small'
  ])(
    'releases %s at its actual impact and cleans the trail at completion',
    async (id) => {
      const timeline = gsap.timeline({ paused: true })
      const presenter = new MatchVfxPresenter(
        { burnNoise: Texture.EMPTY, playSpotlight1: Texture.EMPTY },
        () => timeline
      )
      const template = getVfxTemplateLibrary().templates.find((t) => t.id === id)!
      if (template.family !== 'missile') throw new Error('Expected a missile template')
      const impactSeconds =
        (template.tuning.launchDelayMs ?? FIREBALL_LAYOUT.birth.waitSeconds * 1000) /
          1000 +
        template.tuning.durationMs / 1000
      const visual = {
        duration: impactSeconds + 1,
        impactSeconds,
        update: vi.fn(),
        dispose: vi.fn()
      }
      vi.spyOn(
        presenter as unknown as { makeMissile(): typeof visual },
        'makeMissile'
      ).mockReturnValue(visual)
      const resolved = vi.fn()
      const playing = presenter
        .play(template, true, { x: 0, y: 0 }, { x: 100, y: 100 })
        .then(resolved)
      timeline.time(impactSeconds - 0.01, false)
      await Promise.resolve()
      expect(resolved).not.toHaveBeenCalled()
      timeline.time(impactSeconds + 0.01, false)
      await playing
      expect(resolved).toHaveBeenCalledOnce()
      expect(visual.dispose).not.toHaveBeenCalled()
      timeline.progress(1, false)
      expect(visual.dispose).toHaveBeenCalledOnce()
      presenter.dispose()
      expect(visual.dispose).toHaveBeenCalledOnce()
    }
  )

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

describe('reviewed VFX variants', () => {
  const actionAt = (cardId: string, path: string): Record<string, unknown> => {
    let value: unknown = CARD_CATALOG.require(cardId)
    for (const key of path.split('/')) value = (value as Record<string, unknown>)[key]
    return value as Record<string, unknown>
  }

  it('copies each colored AoE into exactly its original coverage and timing', () => {
    const templates = getVfxTemplateLibrary().templates
    const variants = templates.filter(
      (t) => t.family === 'aoe' && !t.id.startsWith('fire-')
    )
    expect(variants).toHaveLength(14)
    for (const variant of variants) {
      if (variant.family !== 'aoe') throw new Error('Expected AoE')
      const [color, suffix] = variant.id.split('-blast-')
      const coverage = templates.find((t) => t.id === `fire-blast-${suffix}`)!
      const appearance = templates.find(
        (t) => t.id === `${color}-blast-all-characters`
      )!
      if (coverage.family !== 'aoe' || appearance.family !== 'aoe')
        throw new Error('Expected AoE')
      expect(variant.zones).toEqual(coverage.zones)
      expect(variant.tuning).toEqual(appearance.tuning)
      expect(variant.tuning.impactMs).toBe(coverage.tuning.impactMs)
      expect(variant.tuning.fire.timingScale).toBe(coverage.tuning.fire.timingScale)
      for (const local of [false, true])
        expect(matchVfxAreas(variant.zones, local)).toEqual(
          matchVfxAreas(coverage.zones, local)
        )
    }
  })

  it.each([
    [
      'classic_starfall',
      'effects/0/choice/options/0/actions/0',
      'arcane-missile-small'
    ],
    [
      'classic_starfall',
      'effects/0/choice/options/1/actions/0',
      'shadow-blast-enemy-board'
    ],
    ['classic_holy_nova', 'effects/0/actions/0', 'holy-blast-enemy-side'],
    ['goblins_vs_gnomes_demonheart', 'effects/1/actions/0', 'shadow-missile-small'],
    [
      'knights_of_the_frozen_throne_death_coil',
      'effects/0/choice/options/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'knights_of_the_frozen_throne_defile',
      'effects/0/actions/0',
      'shadow-blast-both-boards'
    ],
    [
      'knights_of_the_frozen_throne_defile',
      'effects/0/repeat/actions/0',
      'shadow-blast-both-boards'
    ],
    [
      'mean_streets_of_gadgetzan_greater_arcane_missiles',
      'effects/0/actions/0',
      'arcane-missile-small'
    ],
    [
      'mean_streets_of_gadgetzan_greater_arcane_missiles',
      'effects/0/actions/1',
      'arcane-missile-small'
    ],
    [
      'mean_streets_of_gadgetzan_greater_arcane_missiles',
      'effects/0/actions/2',
      'arcane-missile-small'
    ],
    [
      'mean_streets_of_gadgetzan_jade_lightning',
      'effects/0/actions/0',
      'frost-missile-small'
    ],
    ['classic_pyroblast', 'effects/0/actions/0', 'fire-missile-large'],
    ['basic_fireball', 'effects/0/actions/0', 'fire-missile'],
    ['basic_soulfire', 'effects/0/actions/0', 'fire-missile'],
    ['basic_backstab', 'effects/0/actions/0', 'fire-missile'],
    ['classic_knife_juggler', 'effects/0/actions/0', 'fire-missile'],
    ['basic_corruption', 'effects/0/actions/0/actions/0', 'fire-missile'],
    ['classic_explosive_shot', 'effects/0/actions/0/actions/0', 'fire-missile'],
    ['classic_explosive_shot', 'effects/0/actions/0/actions/1', 'fire-missile']
  ])('%s preserves its reviewed action appearance at %s', (cardId, path, vfx) =>
    expect(actionAt(cardId, path).vfx).toBe(vfx)
  )

  it('preserves selective targets and keeps healing, buffs, freeze and self-cost unanimated', () => {
    expect(actionAt('basic_dread_infernal', 'effects/0/actions/0').target).toEqual({
      controller: 'any',
      type: 'character',
      selection: 'all',
      exclude: 'source'
    })
    expect(
      actionAt('mean_streets_of_gadgetzan_abyssal_enforcer', 'effects/0/actions/0')
        .target
    ).toEqual({
      controller: 'any',
      type: 'character',
      selection: 'all',
      exclude: 'source'
    })
    expect(
      actionAt('goblins_vs_gnomes_scarlet_purifier', 'effects/0/actions/0').target
    ).toEqual({
      controller: 'any',
      type: 'minion',
      selection: 'all',
      filter: { hasDeathrattle: true }
    })
    for (const [id, path] of [
      ['classic_holy_nova', 'effects/0/actions/1'],
      ['classic_demonfire', 'effects/0/actions/0'],
      ['goblins_vs_gnomes_demonheart', 'effects/0/actions/0'],
      [
        'knights_of_the_frozen_throne_death_coil',
        'effects/0/choice/options/1/actions/0'
      ],
      ['knights_of_the_frozen_throne_avalanche', 'effects/0/actions/0'],
      ['classic_flame_imp', 'effects/0/actions/0'],
      ['basic_corruption', 'effects/0/actions/0']
    ])
      expect(actionAt(id, path)).not.toHaveProperty('vfx')
    expect(HERO_POWER_CATALOG.require('warlock-life-tap').effect).not.toHaveProperty(
      'vfx'
    )
  })

  it('keeps generated potion ingredients independently mapped with stable action order', () => {
    const potions = CARD_CATALOG.all.filter((card) =>
      card.id.startsWith('mean_streets_of_gadgetzan_kazakus_potion_')
    )
    let heart = 0,
      fel = 0
    for (const potion of potions) {
      const actions = (
        potion.effects[0] as unknown as { actions: Record<string, unknown>[] }
      ).actions
      const tier = [1, 5, 10].indexOf(potion.cost)
      expect(tier).toBeGreaterThanOrEqual(0)
      for (const action of actions) {
        if (action.action !== 'damage') {
          expect(action).not.toHaveProperty('vfx')
          continue
        }
        const target = action.target as Record<string, unknown>
        if (target.selection === 'chosen') {
          heart++
          expect(action.vfx).toBe(
            ['fire-missile-small', 'fire-missile', 'fire-missile-large'][tier]
          )
          expect(target).toEqual({
            controller: 'any',
            type: 'character',
            selection: 'chosen'
          })
        } else {
          fel++
          expect(action.vfx).toBe('fel-blast-both-boards')
          expect(target).toEqual({
            controller: 'any',
            type: 'minion',
            selection: 'all'
          })
        }
      }
      if (potion.id.includes('heart_of_fire_felbloom'))
        expect(actions.map((a) => a.vfx)).toEqual([
          ['fire-missile-small', 'fire-missile', 'fire-missile-large'][tier],
          'fel-blast-both-boards'
        ])
    }
    expect(heart).toBe(26)
    expect(fel).toBe(26)
  })
})
