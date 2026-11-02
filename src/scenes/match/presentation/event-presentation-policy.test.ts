import { gsap } from 'gsap'
import { Container, Texture } from 'pixi.js'
import { ImpactShakeController } from '../../../visual-components/animation/impact-shake'
import { IMPACT_SHAKE_LAYOUT as SHAKE } from '../../../visual-components/animation/impact-shake-layout'
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
  it('maps every authored heal, including nested choices and triggers, to a healing template', () => {
    const library = getVfxTemplateLibrary()
    let actions = 0
    const visit = (entry: unknown): void => {
      if (!entry || typeof entry !== 'object') return
      const record = entry as Record<string, unknown>
      if (record.action === 'restore') {
        actions++
        const template = library.templates.find((t) => t.id === record.vfx)
        expect(template?.family, String(record.vfx)).toMatch(/^heal-(aoe|target)$/)
      }
      Object.values(record).forEach(visit)
    }
    visit(CARD_CATALOG.all)
    expect(actions).toBe(61)
    for (const power of HERO_POWER_CATALOG.all) {
      if (
        power.effect.kind === 'restore-character' ||
        power.effect.kind === 'restore-and-buff-minion'
      )
        expect(power.effect.vfx).toBe('heal-target')
    }
  })
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
    'frost-missile-small',
    'nature-missile-small',
    'nature-missile-left',
    'neutral-missile-raw',
    'cthun-missile'
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

describe('VFX impact shake', () => {
  it.each(['missile', 'aoe'] as const)(
    'shakes %s only at impact and releases the queue immediately',
    async (family) => {
      const template = structuredClone(
        getVfxTemplateLibrary().templates.find((t) => t.family === family)!
      )
      const timeline = gsap.timeline({ paused: true })
      const shake = vi.fn()
      const presenter = new MatchVfxPresenter(
        { burnNoise: Texture.EMPTY, playSpotlight1: Texture.EMPTY },
        () => timeline,
        undefined,
        shake
      )
      const impact = family === 'missile' ? 1.4 : 0.5
      const visual = {
        duration: 2,
        ...(family === 'missile' ? { impactSeconds: impact } : {}),
        update: vi.fn(),
        dispose: vi.fn()
      }
      vi.spyOn(
        presenter as unknown as { makeMissile(): typeof visual },
        'makeMissile'
      ).mockReturnValue(visual)
      vi.spyOn(
        presenter as unknown as { makeAoe(): typeof visual },
        'makeAoe'
      ).mockReturnValue(visual)
      const pending = presenter.play(template, true, { x: 0, y: 0 }, { x: 1, y: 1 })
      timeline.time(impact - 0.001, false)
      expect(shake).not.toHaveBeenCalled()
      timeline.time(impact + 0.001, false)
      await pending
      expect(shake).toHaveBeenCalledExactlyOnceWith(
        template.tuning.impactShake?.intensity ?? 1
      )
      timeline.time(impact - 0.1, false)
      timeline.time(impact + 0.1, false)
      expect(shake).toHaveBeenCalledOnce()
      expect(visual.dispose).not.toHaveBeenCalled()
      presenter.dispose()
    }
  )

  it.each([
    { enabled: false, intensity: 3 },
    { enabled: true, intensity: 0 },
    { enabled: true, intensity: 3 }
  ])(
    'honors toggle and intensity %j, including hero-only AoEs',
    async (impactShake) => {
      const original = getVfxTemplateLibrary().templates.find(
        (t) => t.family === 'aoe'
      )!
      if (original.family !== 'aoe') throw Error('Expected AoE')
      const template = {
        ...original,
        zones: ['enemyHero'] as const,
        tuning: { ...original.tuning, impactMs: 0, impactShake }
      }
      const timeline = gsap.timeline({ paused: true })
      const shake = vi.fn()
      const presenter = new MatchVfxPresenter(
        { burnNoise: Texture.EMPTY, playSpotlight1: Texture.EMPTY },
        () => timeline,
        undefined,
        shake
      )
      const visual = { duration: 1, update: vi.fn(), dispose: vi.fn() }
      vi.spyOn(
        presenter as unknown as { makeAoe(): typeof visual },
        'makeAoe'
      ).mockReturnValue(visual)
      const pending = presenter.play(template, true)
      timeline.time(0.001, false)
      await pending
      if (impactShake.enabled && impactShake.intensity > 0)
        expect(shake).toHaveBeenCalledExactlyOnceWith(3)
      else expect(shake).not.toHaveBeenCalled()
      presenter.dispose()
    }
  )

  it('does not shake cancelled effects, and requests every simultaneous or repeated hit', async () => {
    const timelines: gsap.core.Timeline[] = []
    const shake = vi.fn()
    const presenter = new MatchVfxPresenter(
      { burnNoise: Texture.EMPTY, playSpotlight1: Texture.EMPTY },
      () => {
        const timeline = gsap.timeline({ paused: true })
        timelines.push(timeline)
        return timeline
      },
      undefined,
      shake
    )
    const visual = () => ({
      duration: 1,
      impactSeconds: 0.4,
      update: vi.fn(),
      dispose: vi.fn()
    })
    vi.spyOn(
      presenter as unknown as { makeMissile(): ReturnType<typeof visual> },
      'makeMissile'
    ).mockImplementation(visual)
    const template = getVfxTemplateLibrary().templates.find(
      (t) => t.id === 'cthun-missile'
    )!
    const play = () => presenter.play(template, true, { x: 0, y: 0 }, { x: 1, y: 1 })
    const cancelled = play()
    timelines[0].time(0.2, false)
    timelines[0].kill()
    await cancelled
    expect(shake).not.toHaveBeenCalled()
    const hits = [play(), play(), play()]
    for (const timeline of timelines.slice(1)) timeline.time(0.401, false)
    await Promise.all(hits)
    expect(shake).toHaveBeenCalledTimes(3)
    const pending = play()
    presenter.dispose()
    await pending
    expect(shake).toHaveBeenCalledTimes(3)
  })
})

describe('capped impact shake animation', () => {
  function setup() {
    const target = new Container()
    target.position.set(100, 200)
    target.pivot.set(7, 9)
    let timeline!: gsap.core.Timeline
    const shake = new ImpactShakeController(target, {
      timeline: (options) => {
        timeline = gsap.timeline({ ...options, paused: true })
        return timeline
      },
      cancel: (animation) => {
        animation.kill()
      }
    })
    return {
      target,
      shake,
      get timeline() {
        return timeline
      }
    }
  }

  it('scales displacement, caps simultaneous hits, and preserves concurrent position animations', () => {
    const normal = setup(),
      heavy = setup()
    normal.shake.trigger(1)
    for (let i = 0; i < 20; i++) heavy.shake.trigger(3)
    normal.timeline.time(SHAKE.duration / 12, false)
    heavy.timeline.time(SHAKE.duration / 12, false)
    expect(heavy.target.pivot.x - 7).toBeCloseTo((normal.target.pivot.x - 7) * 3)
    expect(Math.abs(heavy.target.pivot.x - 7)).toBeLessThanOrEqual(SHAKE.amplitude * 3)
    heavy.target.position.set(150, 250)
    heavy.timeline.progress(1, false)
    expect([heavy.target.pivot.x, heavy.target.pivot.y]).toEqual([7, 9])
    expect([heavy.target.x, heavy.target.y]).toEqual([150, 250])
    normal.shake.dispose()
    heavy.shake.dispose()
    normal.target.destroy()
    heavy.target.destroy()
  })

  it('refreshes on a new hit without discarding a stronger active envelope', () => {
    const single = setup(),
      combined = setup()
    single.shake.trigger(3)
    combined.shake.trigger(3)
    single.timeline.time(0.03, false)
    combined.timeline.time(0.03, false)
    combined.shake.trigger(0.1)
    single.timeline.time(0.04, false)
    combined.timeline.time(0.04, false)
    expect(combined.target.pivot.x).toBeCloseTo(single.target.pivot.x)
    combined.timeline.time(0.16, false)
    combined.shake.trigger(1)
    combined.timeline.time(0.2, false)
    expect(combined.target.pivot.x).not.toBe(7)
    combined.timeline.progress(1, false)
    expect([combined.target.pivot.x, combined.target.pivot.y]).toEqual([7, 9])
    single.shake.dispose()
    combined.shake.dispose()
    single.target.destroy()
    combined.target.destroy()
  })

  it('restores pivot on reset, interruption, and disposal, and ignores zero or disposed triggers', () => {
    const test = setup()
    test.shake.trigger(0)
    expect(test.timeline).toBeUndefined()
    test.shake.trigger()
    test.timeline.time(0.015, false)
    test.shake.reset()
    expect([test.target.pivot.x, test.target.pivot.y]).toEqual([7, 9])
    test.shake.trigger()
    test.timeline.time(0.015, false)
    test.timeline.kill()
    expect([test.target.pivot.x, test.target.pivot.y]).toEqual([7, 9])
    test.shake.trigger()
    test.timeline.time(0.015, false)
    test.shake.dispose()
    expect([test.target.pivot.x, test.target.pivot.y]).toEqual([7, 9])
    test.shake.trigger(3)
    expect([test.target.pivot.x, test.target.pivot.y]).toEqual([7, 9])
    test.target.destroy()
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
    ['classic_leper_gnome', 'effects/0/actions/0', 'nature-missile-small'],
    ['basic_cleave', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_execute', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['blackrock_mountain_axe_flinger', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_cruel_taskmaster', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_inner_rage', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_mortal_strike', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_shield_slam', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_slam', 'effects/0/actions/0', 'neutral-missile-raw'],
    [
      'goblins_vs_gnomes_bouncing_blade',
      'effects/0/repeat/actions/0',
      'neutral-missile-raw'
    ],
    ['goblins_vs_gnomes_crush', 'effects/1/actions/0', 'neutral-missile-raw'],
    [
      'knights_of_the_frozen_throne_animated_berserker',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    ['the_grand_tournament_bash', 'effects/0/actions/0', 'neutral-missile-raw'],
    [
      'whispers_of_the_old_gods_blood_to_ichor',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    ['whispers_of_the_old_gods_cthun', 'effects/0/actions/0', 'cthun-missile'],
    ['classic_naturalize', 'effects/0/actions/0', 'nature-missile-left'],
    ['classic_wrath', 'effects/0/choice/options/0/actions/0', 'nature-missile-left'],
    ['classic_wrath', 'effects/0/choice/options/1/actions/0', 'nature-missile-left'],
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
    ['basic_backstab', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_knife_juggler', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_corruption', 'effects/0/actions/0/actions/0', 'shadow-missile-small'],
    ['classic_explosive_shot', 'effects/0/actions/0/actions/0', 'fire-missile'],
    ['classic_explosive_shot', 'effects/0/actions/0/actions/1', 'fire-missile'],
    ['basic_assassinate', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_elven_archer', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_hammer_of_wrath', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_holy_smite', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_multi_shot', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_nightblade', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_sacrificial_pact', 'effects/0/actions/0', 'shadow-missile-small'],
    ['basic_shadow_word_death', 'effects/0/actions/0', 'shadow-missile-small'],
    ['basic_shadow_word_pain', 'effects/0/actions/0', 'shadow-missile-small'],
    ['basic_shiv', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_sinister_strike', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_stormpike_commando', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['basic_swipe', 'effects/0/actions/0/actions/0', 'neutral-missile-raw'],
    ['blackrock_mountain_quick_shot', 'effects/0/actions/0', 'neutral-missile-raw'],
    [
      'blackrock_mountain_blackwing_corruptor',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    ['blackrock_mountain_rend_blackhand', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_avenging_wrath', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_barrel_toss', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_betrayal', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_big_game_hunter', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_deadly_shot', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_demolisher', 'effects/0/actions/0', 'fire-missile-small'],
    ['classic_demonfire', 'effects/1/actions/0', 'nature-missile-small'],
    ['classic_earth_shock', 'effects/0/actions/1', 'nature-missile-small'],
    ['classic_eviscerate', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_eviscerate', 'effects/1/actions/0', 'neutral-missile-raw'],
    ['classic_eye_for_an_eye', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_headcrack', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_hogger_smash', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_holy_fire', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_holy_wrath', 'effects/0/actions/1', 'neutral-missile-raw'],
    ['classic_hungry_crab', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_ironforge_rifleman', 'effects/0/actions/0', 'neutral-missile-raw'],
    [
      'classic_keeper_of_the_grove',
      'effects/0/choice/options/0/actions/0',
      'nature-missile-left'
    ],
    ['classic_kill_command', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_kill_command', 'effects/1/actions/0', 'neutral-missile-raw'],
    ['classic_mad_bomber', 'effects/0/actions/0', 'fire-missile-small'],
    [
      'classic_power_overwhelming',
      'effects/0/actions/1/actions/0',
      'shadow-missile-small'
    ],
    ['classic_savagery', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_si_7_agent', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_siphon_soul', 'effects/0/actions/0', 'shadow-missile-small'],
    ['classic_snipe', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_stampeding_kodo', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_the_black_knight', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['classic_nightmare', 'effects/0/actions/1/actions/0', 'shadow-missile-small'],
    ['goblins_vs_gnomes_cobra_shot', 'effects/0/actions/0', 'nature-missile-small'],
    ['goblins_vs_gnomes_cobra_shot', 'effects/0/actions/1', 'nature-missile-small'],
    ['goblins_vs_gnomes_goblin_blastmage', 'effects/0/actions/0', 'fire-missile-small'],
    ['goblins_vs_gnomes_shadowboxer', 'effects/0/actions/0', 'shadow-missile-small'],
    ['goblins_vs_gnomes_sabotage', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['goblins_vs_gnomes_fel_cannon', 'effects/0/actions/0', 'nature-missile-small'],
    ['goblins_vs_gnomes_imp_losion', 'effects/0/actions/0', 'nature-missile-small'],
    ['goblins_vs_gnomes_ships_cannon', 'effects/0/actions/0', 'neutral-missile-raw'],
    [
      'goblins_vs_gnomes_hemet_nesingwary',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    ['goblins_vs_gnomes_madder_bomber', 'effects/0/actions/0', 'fire-missile-small'],
    [
      'journey_to_ungoro_vilespine_slayer',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    ['journey_to_ungoro_golakka_crawler', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['journey_to_ungoro_tidal_surge', 'effects/0/actions/0', 'frost-missile-small'],
    [
      'journey_to_ungoro_volatile_elemental',
      'effects/0/actions/0',
      'frost-missile-small'
    ],
    [
      'journey_to_ungoro_corrupting_mist',
      'effects/0/actions/0/actions/0',
      'shadow-missile-small'
    ],
    ['journey_to_ungoro_feeding_time', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['journey_to_ungoro_grievous_bite', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['journey_to_ungoro_grievous_bite', 'effects/0/actions/1', 'neutral-missile-raw'],
    ['journey_to_ungoro_razorpetal', 'effects/0/actions/0', 'nature-missile-small'],
    [
      'knights_of_the_frozen_throne_obliterate',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'knights_of_the_frozen_throne_toxic_arrow',
      'effects/0/actions/0',
      'nature-missile-small'
    ],
    [
      'knights_of_the_frozen_throne_ultimate_infestation',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'knights_of_the_frozen_throne_obsidian_statue',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'knights_of_the_frozen_throne_doomerang',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'knights_of_the_frozen_throne_blackguard',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'knights_of_the_frozen_throne_wretched_tiller',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'knights_of_the_frozen_throne_unwilling_sacrifice',
      'effects/0/actions/1',
      'shadow-missile-small'
    ],
    [
      'knights_of_the_frozen_throne_spectral_pillager',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    ['league_of_explorers_dart_trap', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['league_of_explorers_sacred_trial', 'effects/0/actions/0', 'neutral-missile-raw'],
    [
      'league_of_explorers_rumbling_elemental',
      'effects/0/actions/0',
      'frost-missile-small'
    ],
    ['league_of_explorers_huge_toad', 'effects/0/actions/0', 'nature-missile-small'],
    [
      'league_of_explorers_timepiece_of_horror',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'mean_streets_of_gadgetzan_jade_shuriken',
      'effects/0/actions/0',
      'nature-missile-small'
    ],
    [
      'mean_streets_of_gadgetzan_blastcrystal_potion',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'mean_streets_of_gadgetzan_blowgill_sniper',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'mean_streets_of_gadgetzan_backstreet_leper',
      'effects/0/actions/0',
      'nature-missile-small'
    ],
    [
      'mean_streets_of_gadgetzan_dispatch_kodo',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'mean_streets_of_gadgetzan_knuckles',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    ['naxxramas_reincarnate', 'effects/0/actions/0', 'nature-missile-small'],
    [
      'one_night_in_karazhan_medivhs_valet',
      'effects/0/actions/0',
      'fire-missile-small'
    ],
    ['one_night_in_karazhan_book_wyrm', 'effects/0/actions/0', 'arcane-missile-small'],
    ['one_night_in_karazhan_moat_lurker', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['the_grand_tournament_brave_archer', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['the_grand_tournament_powershot', 'effects/0/actions/0', 'neutral-missile-raw'],
    ['the_grand_tournament_acidmaw', 'effects/0/actions/0', 'nature-missile-small'],
    [
      'the_grand_tournament_undercity_valiant',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'the_grand_tournament_fist_of_jaraxxus',
      'effects/0/actions/0',
      'nature-missile-small'
    ],
    [
      'the_grand_tournament_fist_of_jaraxxus',
      'effects/1/actions/0',
      'nature-missile-small'
    ],
    [
      'the_grand_tournament_dark_bargain',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'the_grand_tournament_void_crusher',
      'effects/0/actions/0',
      'shadow-missile-small'
    ],
    [
      'the_grand_tournament_void_crusher',
      'effects/0/actions/1',
      'shadow-missile-small'
    ],
    [
      'the_grand_tournament_gormok_the_impaler',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'the_grand_tournament_north_sea_kraken',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    [
      'whispers_of_the_old_gods_on_the_hunt',
      'effects/0/actions/0',
      'neutral-missile-raw'
    ],
    ['whispers_of_the_old_gods_shatter', 'effects/0/actions/0', 'frost-missile-small'],
    ['whispers_of_the_old_gods_blade_of_cthun', 'effects/0/actions/0', 'cthun-missile'],
    ['blackrock_mountain_dragons_breath', 'effects/0/actions/0', 'fire-missile'],
    ['classic_lava_burst', 'effects/0/actions/0', 'fire-missile'],
    ['classic_vaporize', 'effects/0/actions/0', 'fire-missile'],
    ['goblins_vs_gnomes_flamecannon', 'effects/0/actions/0', 'fire-missile'],
    ['goblins_vs_gnomes_bomb_lobber', 'effects/0/actions/0', 'fire-missile'],
    ['goblins_vs_gnomes_boom_bot', 'effects/0/actions/0', 'fire-missile'],
    ['journey_to_ungoro_invocation_of_fire', 'effects/0/actions/0', 'fire-missile'],
    ['journey_to_ungoro_blazecaller', 'effects/0/actions/0', 'fire-missile'],
    ['journey_to_ungoro_meteor', 'effects/0/actions/1', 'fire-missile'],
    ['league_of_explorers_roaring_torch', 'effects/0/actions/0', 'fire-missile'],
    ['mean_streets_of_gadgetzan_bomb_squad', 'effects/0/actions/0', 'fire-missile'],
    ['one_night_in_karazhan_firelands_portal', 'effects/0/actions/0', 'fire-missile'],
    ['whispers_of_the_old_gods_forbidden_flame', 'effects/0/actions/1', 'fire-missile']
  ])('%s preserves its reviewed action appearance at %s', (cardId, path, vfx) =>
    expect(actionAt(cardId, path).vfx).toBe(vfx)
  )

  it('preserves selective targets and keeps buffs and self-cost unanimated', () => {
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
      ['classic_demonfire', 'effects/0/actions/0'],
      ['goblins_vs_gnomes_demonheart', 'effects/0/actions/0'],
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
        if (action.action === 'freeze') {
          expect(action.vfx).toBe('frost-missile-small')
          continue
        }
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
