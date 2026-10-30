import { prewarmMinionStatus } from '../loading/minion-status-warmup'
import {
  matchVisualTextures,
  MatchVisualResources
} from '../loading/match-visual-resources'
import { MinionStatusCurtainEffect } from './minion-status-curtain-effect'
import { minionAuraSample } from './minion-aura-effect'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import type { BoardMinion } from '../../../game-rules/match/opening-match-types'
import { boardMinionAbilityMarkers } from './board-ability-markers'
import type { GameAssets } from '../../../visual-components/assets'
import { prewarmWindfury } from '../loading/windfury-warmup'
import { WINDFURY_DEFAULTS } from '../../../desktop/contracts/ipc/windfury-tuning'
import type { Container, Renderer, RenderTexture } from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { Graphics, Sprite, Text, Texture, TextureSource } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../visual-components/effects/animated-outline', () => ({
  AnimatedOutline: class {
    private enabled = false
    setEnabled(enabled: boolean): void {
      this.enabled = enabled
    }
    isEnabled(): boolean {
      return this.enabled
    }
    dispose(): void {}
  }
}))
vi.mock('@outline-directions', () => ({
  getExperimentalOutlineDirectionId: () => undefined,
  resolveExperimentalOutlineTuning: (
    _direction: string | undefined,
    _preset: string,
    tuning: unknown
  ) => tuning
}))
import {
  MinionView,
  type MinionViewModel,
  type MinionViewTextures
} from './minion-view'
import { WeaponView, type WeaponViewTextures } from './weapon-view'
import {
  setPremiumEnabled,
  setPremiumMode
} from '../../../visual-components/cards/premium-appearance'

const textures: MinionViewTextures = {
  curtainSpark: Texture.EMPTY,
  curtainMote: Texture.EMPTY,
  lifesteal: Texture.EMPTY,
  aura: Texture.EMPTY,
  elusive: Texture.EMPTY,
  immune: Texture.EMPTY,
  frame: Texture.EMPTY,
  premiumFrame: Texture.WHITE,
  legendaryFrame: Texture.EMPTY,
  premiumLegendaryFrame: Texture.WHITE,
  taunt: Texture.EMPTY,
  premiumTaunt: Texture.WHITE,
  battlecry: Texture.EMPTY,
  enrage: Texture.EMPTY,
  divineShield: Texture.EMPTY,
  frozen: Texture.EMPTY,
  stealth: Texture.EMPTY,
  trigger: Texture.EMPTY,
  inspire: Texture.EMPTY,
  deathrattle: Texture.EMPTY,
  poisonous: Texture.EMPTY,
  attack: Texture.EMPTY,
  health: Texture.EMPTY
}

const tauntMinion: MinionViewModel = {
  label: 'test-minion',
  attack: 2,
  health: 3,
  maxHealth: 3,
  legendary: false,
  taunt: true,
  enraged: false,
  divineShield: false,
  stealth: false,
  frozen: false,
  deathrattle: false,
  poisonous: true,
  aura: false,
  trigger: false,
  inspire: false,
  windfury: false,
  spellDamage: false,
  lifesteal: false,
  elusive: false,
  immune: false
}

describe('MinionView dormant overlay', () => {
  it('shows progress briefly, ignores refreshes, and cancels timers on disposal', async () => {
    const view = await MinionView.create(
      { ...tauntMinion, dormant: true },
      textures,
      undefined
    )
    const timers = vi.spyOn(AnimationScope.prototype, 'timeline')
    try {
      const label = view.getChildByLabel('minion.dormant-progress') as Text
      expect(label.visible).toBe(false)
      view.showDormantProgress(1, 2, 5)
      const first = timers.mock.results[0]!.value as ReturnType<
        AnimationScope['timeline']
      >
      first.pause()
      expect(label.text).toBe('1/2')
      expect(label.visible).toBe(true)
      expect(label.eventMode).toBe('none')
      const trigger = view.getChildByLabel('minion.trigger')!
      expect(label.position).toMatchObject({ x: trigger.x, y: trigger.y })
      expect(view.getChildIndex(label)).toBeGreaterThan(view.getChildIndex(trigger))
      view.setDormant(true)
      view.showDormantProgress(1, 2, 5)
      expect(timers).toHaveBeenCalledTimes(1)
      first.seek(1.99, false)
      expect(label.visible).toBe(true)
      first.seek(2, false)
      expect(label.visible).toBe(false)
      view.showDormantProgress(1, 2, 5)
      expect(label.visible).toBe(false)
      view.setDormant(false)
      view.showDormantProgress(2, 2, 7)
      expect(label.text).toBe('2/2')
      expect(label.visible).toBe(true)
      const final = timers.mock.results[1]!.value as ReturnType<
        AnimationScope['timeline']
      >
      const kill = vi.spyOn(final, 'kill')
      view.destroy({ children: true })
      expect(kill).toHaveBeenCalled()
      expect(label.destroyed).toBe(true)
      expect(() => view.showDormantProgress(2, 2, 9)).not.toThrow()
    } finally {
      timers.mockRestore()
      if (!view.destroyed) view.destroy({ children: true })
    }
  })

  it('keeps simultaneous counters independent and replaces an unfinished hold', async () => {
    const first = await MinionView.create(
      { ...tauntMinion, dormant: true },
      textures,
      undefined
    )
    const second = await MinionView.create(
      { ...tauntMinion, dormant: true },
      textures,
      undefined
    )
    const timers = vi.spyOn(AnimationScope.prototype, 'timeline')
    try {
      first.showDormantProgress(1, 2, 5)
      const oldTimer = timers.mock.results[0]!.value as ReturnType<
        AnimationScope['timeline']
      >
      oldTimer.pause()
      const cancel = vi.spyOn(oldTimer, 'kill')
      second.showDormantProgress(1, 2, 5)
      const otherTimer = timers.mock.results[1]!.value as ReturnType<
        AnimationScope['timeline']
      >
      otherTimer.pause()
      first.setDormant(false)
      first.showDormantProgress(2, 2, 6)
      expect(cancel).toHaveBeenCalled()
      const newTimer = timers.mock.results[2]!.value as ReturnType<
        AnimationScope['timeline']
      >
      newTimer.pause().seek(2, false)
      expect(first.getChildByLabel('minion.dormant-progress')!.visible).toBe(false)
      expect(second.getChildByLabel('minion.dormant-progress')!.visible).toBe(true)
    } finally {
      timers.mockRestore()
      first.destroy({ children: true })
      second.destroy({ children: true })
    }
  })

  it.each([
    { label: 'Nether Portal', statsVisible: false },
    { label: 'Underfel Rift', statsVisible: false },
    { label: 'Sherazin', statsVisible: true }
  ])(
    'hides $label stats while dormant and restores its visibility on awakening',
    async (model) => {
      const dormantTexture = new Texture({
        source: new TextureSource({ width: 115, height: 157 })
      })
      const view = await MinionView.create(
        {
          ...tauntMinion,
          ...model,
          dormant: true,
          taunt: false,
          trigger: true
        },
        { ...textures, dormant: dormantTexture },
        Texture.WHITE
      )
      try {
        const overlay = view.getChildByLabel('minion.dormant') as Sprite
        const index = (label: string) =>
          view.getChildIndex(view.getChildByLabel(label)!)
        expect(overlay.texture).toBe(dormantTexture)
        expect(overlay.visible).toBe(true)
        expect(overlay.position).toMatchObject({ x: 80, y: 90 })
        expect(overlay.anchor).toMatchObject({ x: 0.5, y: 0.5 })
        expect(overlay.scale).toMatchObject({ x: 1, y: 1 })
        expect(overlay.width).toBe(115)
        expect(overlay.height).toBe(157)
        expect(overlay.eventMode).toBe('none')
        expect(index('minion.dormant')).toBeGreaterThan(index('minion.artwork'))
        expect(index('minion.dormant')).toBeLessThan(index('minion.frame'))
        expect(index('minion.dormant')).toBeLessThan(index('minion.trigger'))
        expect(view.getChildByLabel('minion.trigger')?.visible).toBe(true)
        for (const name of ['attack', 'health']) {
          expect(view.getChildByLabel(`minion.stat-${name}`)?.visible).toBe(false)
        }
        const silhouette = view.shadow.silhouette!.create()
        expect(silhouette.getChildByLabel('minion.dormant.shadow-surface')).toBeNull()
        silhouette.destroy({ children: true })

        view.setDormant(false)
        expect(overlay.visible).toBe(false)
        view.setDormant(true)
        view.setDormant(true)
        expect(overlay.visible).toBe(true)
        view.setDormant(false)
        expect(overlay.visible).toBe(false)
        expect(view.getChildByLabel('minion.dormant')).toBe(overlay)
        for (const name of ['attack', 'health']) {
          expect(view.getChildByLabel(`minion.stat-${name}`)?.visible).toBe(
            model.statsVisible
          )
        }
        view.destroy({ children: true })
        expect(overlay.destroyed).toBe(true)
        expect(dormantTexture.destroyed).toBe(false)
      } finally {
        if (!view.destroyed) view.destroy({ children: true })
        dormantTexture.destroy(true)
      }
    }
  )

  it.each(['stats-first', 'dormant-first'] as const)(
    'keeps badges hidden through refreshes and restores current values (%s)',
    async (order) => {
      const view = await MinionView.create(tauntMinion, textures, undefined)
      try {
        const revision = view.shadow.silhouette!.revision
        if (order === 'stats-first') {
          view.setStatsVisible(true)
          view.setDormant(true)
        } else {
          view.setDormant(true)
          view.setStatsVisible(true)
        }
        expect(view.shadow.silhouette!.revision).toBeGreaterThan(revision)
        const hiddenRevision = view.shadow.silhouette!.revision
        view.setStats(7, 3, 5)
        view.setStatsVisible(true)
        view.setDormant(true)
        expect(view.shadow.silhouette!.revision).toBe(hiddenRevision)
        for (const name of ['attack', 'health']) {
          const group = view.getChildByLabel(`minion.stat-${name}`)!
          expect(group.visible).toBe(false)
          expect(group.getChildByLabel(`minion.stat-${name}-badge`)!.parent).toBe(group)
          expect(group.getChildByLabel(`minion.stat-${name}-value`)!.parent).toBe(group)
        }
        view.setDormant(false)
        for (const [name, value] of [
          ['attack', '7'],
          ['health', '3']
        ]) {
          expect(view.getChildByLabel(`minion.stat-${name}`)!.visible).toBe(true)
          expect(
            (view.getChildByLabel(`minion.stat-${name}-value`, true) as Text).text
          ).toBe(value)
        }
        view.setDormant(true)
        view.setStatsVisible(false)
        view.setDormant(false)
        expect(view.getChildByLabel('minion.stat-attack')!.visible).toBe(false)
        expect(view.getChildByLabel('minion.stat-health')!.visible).toBe(false)
      } finally {
        view.destroy({ children: true })
      }
    }
  )

  it('starts hidden on an awake view and reveals the same sprite when dormant', async () => {
    const view = await MinionView.create(
      tauntMinion,
      { ...textures, dormant: Texture.WHITE },
      undefined
    )
    try {
      const overlay = view.getChildByLabel('minion.dormant')!
      expect(overlay.visible).toBe(false)
      view.setDormant(true)
      expect(overlay.visible).toBe(true)
      view.setDormant(false)
      expect(overlay.visible).toBe(false)
    } finally {
      view.destroy({ children: true })
    }
  })

  it('keeps dormant presentation usable when the optional texture is absent', async () => {
    const view = await MinionView.create(
      { ...tauntMinion, dormant: true, statsVisible: false, trigger: true },
      textures,
      undefined
    )
    try {
      expect(view.getChildByLabel('minion.dormant')).toBeNull()
      view.setDormant(false)
      view.setDormant(true)
      expect(view.getChildByLabel('minion.dormant')).toBeNull()
      expect(view.getChildByLabel('minion.trigger')?.visible).toBe(true)
      expect(view.getChildByLabel('minion.stat-attack')?.visible).toBe(false)
      expect(view.getChildByLabel('minion.stat-health')?.visible).toBe(false)
    } finally {
      view.destroy({ children: true })
    }
  })

  it('includes a registered dormant texture in normal match warm-up and residency', async () => {
    const dormantTexture = new Texture({
      source: new TextureSource({ width: 115, height: 157 })
    })
    const resources = new MatchVisualResources()
    const automatic = dormantTexture.source.autoGarbageCollect
    const initSource = vi.fn()
    const renderer = { texture: { initSource } } as unknown as Renderer
    try {
      const assets = {
        boardBase: Texture.EMPTY,
        board1: Texture.WHITE,
        minionDormant: dormantTexture
      }
      const warmed = matchVisualTextures(assets, Texture.WHITE)
      expect(warmed).toEqual([Texture.WHITE, dormantTexture])
      await resources.prepare(renderer, [], warmed, async () => undefined)
      expect(initSource).toHaveBeenCalledWith(dormantTexture.source)
      expect(dormantTexture.source.autoGarbageCollect).toBe(false)
      resources.dispose()
      expect(dormantTexture.source.autoGarbageCollect).toBe(automatic)
      expect(dormantTexture.destroyed).toBe(false)
    } finally {
      resources.dispose()
      dormantTexture.destroy(true)
    }
  })
})

describe('MinionView outline layering', () => {
  it('hides board object stats and their shadows while retaining the trigger marker', async () => {
    const view = await MinionView.create(
      {
        ...tauntMinion,
        attack: 0,
        health: 0,
        maxHealth: 0,
        statsVisible: false,
        dormant: true,
        taunt: false,
        poisonous: false,
        trigger: true
      },
      textures,
      undefined
    )
    try {
      const stats = ['attack', 'health'].map((name) =>
        view.getChildByLabel(`minion.stat-${name}`)!
      )
      expect(stats.every((group) => !group.visible)).toBe(true)
      view.setStats(0, 0, 0)
      expect(stats.every((group) => !group.visible)).toBe(true)
      expect(view.getChildByLabel('minion.trigger')?.visible).toBe(true)
      expect(view.getAbilityMarkerSnapshot('trigger')?.texture).toBe(textures.trigger)

      const silhouette = view.shadow.silhouette!
      const hidden = silhouette.create()
      expect(
        hidden.getChildByLabel('minion.stat-attack-badge.shadow-surface')
      ).toBeNull()
      expect(
        hidden.getChildByLabel('minion.stat-health-badge.shadow-surface')
      ).toBeNull()
      expect(hidden.getChildByLabel('minion.trigger.shadow-surface')).not.toBeNull()
      hidden.destroy({ children: true })

      const revision = silhouette.revision
      view.setDormant(false)
      view.setStatsVisible(true)
      expect(stats.every((group) => group.visible)).toBe(true)
      expect(silhouette.revision).toBeGreaterThan(revision)
      const visible = silhouette.create()
      expect(
        visible.getChildByLabel('minion.stat-attack-badge.shadow-surface')
      ).not.toBeNull()
      expect(
        visible.getChildByLabel('minion.stat-health-badge.shadow-surface')
      ).not.toBeNull()
      visible.destroy({ children: true })
      view.setStatsVisible(false)
      expect(stats.every((group) => !group.visible)).toBe(true)
    } finally {
      view.destroy({ children: true })
    }
  })

  it('blocks dormant attack and target highlights without disabling hover', async () => {
    const view = await MinionView.create(
      { ...tauntMinion, dormant: true },
      textures,
      undefined
    )
    try {
      view.setHoverable(true)
      view.setCanAttack(true)
      view.setTargetable(true)
      view.setTargetingOutline(true)
      view.setSelected(true)
      view.setSleeping(true)
      expect(view.isCanAttack()).toBe(false)
      expect(view.isTargetable()).toBe(false)
      expect(view.isSelected()).toBe(false)
      expect(view.getChildByLabel('minion.attack-outline-proxy')?.visible).toBe(false)
      expect(view.getChildByLabel('minion.targeting-outline-proxy')?.visible).toBe(
        false
      )
      expect(view.getChildByLabel('minion.sleeping-zs', true)?.children).toHaveLength(0)
      expect(view.eventMode).toBe('static')
      expect(view.cursor).toBe('default')

      view.setDormant(false)
      view.setCanAttack(true)
      view.setTargetable(true)
      view.setTargetingOutline(true)
      view.setSelected(true)
      expect(view.isCanAttack()).toBe(true)
      expect(view.isTargetable()).toBe(true)
      expect(view.isSelected()).toBe(true)
      expect(view.getChildByLabel('minion.targeting-outline-proxy')?.visible).toBe(true)

      view.setDormant(true)
      expect(view.isCanAttack()).toBe(false)
      expect(view.isTargetable()).toBe(false)
      expect(view.isSelected()).toBe(false)
      expect(view.getChildByLabel('minion.attack-outline-proxy')?.visible).toBe(false)
      expect(view.getChildByLabel('minion.targeting-outline-proxy')?.visible).toBe(
        false
      )
    } finally {
      view.destroy({ children: true })
    }
  })

  it('refreshes equipped weapons for the selected player', async () => {
    const weaponTextures: WeaponViewTextures = {
      frame: Texture.EMPTY,
      premiumFrame: Texture.WHITE,
      trigger: Texture.EMPTY,
      deathrattle: Texture.EMPTY,
      lifesteal: Texture.EMPTY,
      attack: Texture.EMPTY,
      durability: Texture.EMPTY
    }
    const model = {
      label: 'test.weapon',
      attack: 2,
      durability: 2,
      printedDurability: 2,
      deathrattle: false,
      trigger: false,
      lifesteal: false,
      temporaryAbilityLabels: []
    }
    const views = await Promise.all([
      WeaponView.create({ ...model, premiumSide: 'local' }, weaponTextures, undefined),
      WeaponView.create({ ...model, premiumSide: 'remote' }, weaponTextures, undefined)
    ])
    const frames = () =>
      views.map((view) => (view.getChildByLabel('weapon.frame') as Sprite).texture)
    try {
      setPremiumMode('remote')
      expect(frames()).toEqual([Texture.EMPTY, Texture.WHITE])
      setPremiumMode('local')
      expect(frames()).toEqual([Texture.WHITE, Texture.EMPTY])
      setPremiumMode('unlocked')
      expect(frames()).toEqual([Texture.EMPTY, Texture.EMPTY])
    } finally {
      views.forEach((view) => view.destroy({ children: true }))
      setPremiumMode('unlocked')
    }
  })

  it('colors durability relative to the printed weapon value', async () => {
    const weaponTextures: WeaponViewTextures = {
      frame: Texture.EMPTY,
      premiumFrame: Texture.WHITE,
      trigger: Texture.EMPTY,
      deathrattle: Texture.EMPTY,
      lifesteal: Texture.EMPTY,
      attack: Texture.EMPTY,
      durability: Texture.EMPTY
    }
    const view = await WeaponView.create(
      {
        label: 'test.weapon.colors',
        attack: 2,
        durability: 2,
        printedDurability: 3,
        deathrattle: false,
        trigger: false,
        lifesteal: false,
        temporaryAbilityLabels: []
      },
      weaponTextures,
      undefined
    )
    const durabilityLabel = view
      .getChildByLabel('weapon.stat-durability')!
      .getChildByLabel('weapon.stat-durability-value') as Text
    try {
      expect(durabilityLabel.style.fill).toBe(0xff4a4a)

      view.setDurability(4)
      expect(durabilityLabel.style.fill).toBe(0x6cff47)

      view.setStats(2, 3)
      expect(durabilityLabel.style.fill).toBe(0xffffff)
    } finally {
      view.destroy({ children: true })
    }
  })

  it('updates local and remote frames independently while retaining baseline premiums', async () => {
    const views = await Promise.all([
      MinionView.create({ ...tauntMinion, premiumSide: 'local' }, textures, undefined),
      MinionView.create({ ...tauntMinion, premiumSide: 'remote' }, textures, undefined),
      MinionView.create(
        { ...tauntMinion, premiumSide: 'local', premium: true },
        textures,
        undefined
      )
    ])
    const frames = () =>
      views.map(
        (view) =>
          (view.children.find((child) => child.label === 'minion.frame') as Sprite)
            .texture
      )
    try {
      setPremiumMode('local')
      expect(frames()).toEqual([
        textures.premiumFrame,
        textures.frame,
        textures.premiumFrame
      ])
      setPremiumMode('remote')
      expect(frames()).toEqual([
        textures.frame,
        textures.premiumFrame,
        textures.premiumFrame
      ])
      setPremiumMode('all')
      expect(frames()).toEqual([
        textures.premiumFrame,
        textures.premiumFrame,
        textures.premiumFrame
      ])
      setPremiumMode('unlocked')
      expect(frames()).toEqual([textures.frame, textures.frame, textures.premiumFrame])
    } finally {
      views.forEach((view) => view.destroy({ children: true }))
      setPremiumMode('unlocked')
    }
  })

  it('swaps existing and new board frames without disturbing minion state', async () => {
    const view = await MinionView.create(
      { ...tauntMinion, legendary: true },
      textures,
      undefined
    )
    const frame = view.children.find(
      (child) => child.label === 'minion.frame'
    ) as Sprite
    const placement = { x: frame.x, y: frame.y, scale: frame.scale.x }
    const legendary = view.children.find(
      (child) => child.label === 'minion.frame-legendary'
    ) as Sprite
    try {
      view.setCanAttack(true)
      setPremiumEnabled(true)
      expect(frame.texture).toBe(textures.premiumFrame)
      const taunt = view.children.find(
        (child) => child.label === 'minion.taunt'
      ) as Sprite
      expect(taunt.texture).toBe(textures.premiumTaunt)
      view.setTaunt(false)
      expect(taunt.visible).toBe(false)
      view.setTaunt(true)
      expect(taunt.visible).toBe(true)
      expect(legendary.texture).toBe(textures.premiumLegendaryFrame)
      expect(legendary.visible).toBe(true)
      expect({ x: frame.x, y: frame.y, scale: frame.scale.x }).toEqual(placement)
      expect(view.isCanAttack()).toBe(true)
      const next = await MinionView.create(tauntMinion, textures, undefined)
      const nextLegendary = next.children.find(
        (child) => child.label === 'minion.frame-legendary'
      ) as Sprite
      expect(nextLegendary.texture).toBe(textures.premiumLegendaryFrame)
      expect(nextLegendary.visible).toBe(false)
      expect(
        (next.children.find((child) => child.label === 'minion.frame') as Sprite)
          .texture
      ).toBe(textures.premiumFrame)
      next.destroy({ children: true })
      setPremiumEnabled(false)
      expect(frame.texture).toBe(textures.frame)
      expect(taunt.texture).toBe(textures.taunt)
      expect(legendary.texture).toBe(textures.legendaryFrame)
      view.destroy({ children: true })
      expect(() => setPremiumEnabled(true)).not.toThrow()
    } finally {
      if (!view.destroyed) view.destroy({ children: true })
      setPremiumEnabled(false)
    }
  })

  it('toggles all new ability sprites without rebuilding the minion', async () => {
    const view = await MinionView.create(
      { ...tauntMinion, poisonous: false },
      textures,
      undefined
    )
    const sprites = [
      'windfury.front',
      'windfury.rear',
      'lifesteal',
      'aura',
      'elusive',
      'immune',
      'poisonous'
    ].map((name) => view.children.find((child) => child.label === 'minion.' + name)!)
    expect(sprites.every((sprite) => !sprite.visible)).toBe(true)
    view.setAbilityEffects({
      windfury: true,
      spellDamage: true,
      lifesteal: true,
      aura: true,
      elusive: true,
      immune: true,
      poisonous: true
    })
    expect(sprites.every((sprite) => sprite.visible)).toBe(true)
    view.setAbilityEffects({
      windfury: false,
      spellDamage: false,
      lifesteal: false,
      aura: false,
      elusive: false,
      immune: false,
      poisonous: false
    })
    expect(sprites.every((sprite) => !sprite.visible)).toBe(true)
    view.destroy({ children: true })
  })

  it('renders attack and targeting outlines between Taunt and the minion frame', async () => {
    const view = await MinionView.create(tauntMinion, textures, undefined)

    const childIndex = (label: string): number =>
      view.children.findIndex((child) => child.label === label)

    expect(childIndex('minion.taunt')).toBeLessThan(
      childIndex('minion.attack-outline-proxy')
    )
    expect(childIndex('minion.attack-outline-proxy')).toBeLessThan(
      childIndex('minion.frame')
    )
    expect(childIndex('minion.taunt')).toBeLessThan(
      childIndex('minion.targeting-outline-proxy')
    )
    expect(childIndex('minion.targeting-outline-proxy')).toBeLessThan(
      childIndex('minion.frame')
    )
    expect(childIndex('minion.artwork')).toBeLessThan(childIndex('minion.stealth'))
    expect(childIndex('minion.stealth')).toBeLessThan(childIndex('minion.frame'))
    expect(childIndex('minion.frame-legendary')).toBeLessThan(
      childIndex('minion.frozen')
    )
    expect(childIndex('minion.stealth')).toBeLessThan(childIndex('minion.frozen'))
    expect(childIndex('minion.deathrattle')).toBeLessThan(childIndex('minion.trigger'))
    expect(childIndex('minion.deathrattle')).toBeLessThan(
      childIndex('minion.poisonous')
    )
    expect(childIndex('minion.trigger')).toBeLessThan(childIndex('minion.inspire'))
    expect(childIndex('minion.aura')).toBeLessThan(childIndex('minion.artwork'))
    expect(childIndex('minion.aura')).toBeLessThan(childIndex('minion.windfury.rear'))

    view.setCanAttack(true)
    expect(view.children[childIndex('minion.attack-outline-proxy')].visible).toBe(true)

    view.setTargetingOutline(true)
    expect(view.children[childIndex('minion.targeting-outline-proxy')].visible).toBe(
      true
    )

    view.destroy({ children: true })
  })

  it('pulses the Inspire marker independently from Trigger', async () => {
    const view = await MinionView.create(tauntMinion, textures, undefined)
    const inspire = view.children.find((child) => child.label === 'minion.inspire')
    const trigger = view.children.find((child) => child.label === 'minion.trigger')

    view.setInspire(true)
    expect(inspire?.visible).toBe(true)
    expect(trigger?.visible).toBe(false)

    const pulse = view.presentAbilityPulse('inspire', 0.02)
    expect(view.children.some((child) => child.label === 'minion.inspire.pulse')).toBe(
      true
    )
    await pulse
    expect(view.children.some((child) => child.label === 'minion.inspire.pulse')).toBe(
      false
    )

    view.destroy({ children: true })
  })

  it('renders the battlecry banner between taunt and stealth', async () => {
    const view = await MinionView.create(tauntMinion, textures, undefined)
    const childIndex = (label: string): number =>
      view.children.findIndex((child) => child.label === label)
    const banner = view.children.find(
      (child) => child.label === 'minion.battlecry'
    ) as Sprite

    expect(childIndex('minion.artwork')).toBeLessThan(childIndex('minion.taunt'))
    expect(childIndex('minion.taunt')).toBeLessThan(childIndex('minion.battlecry'))
    expect(childIndex('minion.battlecry')).toBeLessThan(childIndex('minion.stealth'))
    expect(childIndex('minion.battlecry')).toBeLessThan(childIndex('minion.frame'))
    expect(banner.visible).toBe(false)
    expect(banner.alpha).toBe(0)

    view.destroy({ children: true })
  })

  it('grows the battlecry banner, then fades it away after the trigger point', async () => {
    const view = await MinionView.create(tauntMinion, textures, undefined)
    const banner = view.children.find(
      (child) => child.label === 'minion.battlecry'
    ) as Sprite

    const triggerPoint = view.presentBattlecryBanner()
    expect(banner.visible).toBe(true)
    expect(banner.alpha).toBe(0)
    expect(banner.scale.x).toBeCloseTo(0.35)

    await triggerPoint
    expect(banner.scale.x).toBeCloseTo(1)
    expect(banner.alpha).toBeGreaterThan(0.5)
    expect(banner.alpha).toBeLessThanOrEqual(1)

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(banner.visible).toBe(false)
    expect(banner.alpha).toBe(0)

    view.destroy({ children: true })
  })

  it('replays the battlecry banner for repeated Battlecry repetitions', async () => {
    const view = await MinionView.create(tauntMinion, textures, undefined)
    const banner = view.children.find(
      (child) => child.label === 'minion.battlecry'
    ) as Sprite

    await view.presentBattlecryBanner()
    expect(banner.scale.x).toBeCloseTo(1)

    const secondTriggerPoint = view.presentBattlecryBanner()
    expect(banner.scale.x).toBeCloseTo(0.35)
    expect(banner.visible).toBe(true)

    await secondTriggerPoint
    expect(banner.scale.x).toBeCloseTo(1)

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(banner.visible).toBe(false)

    view.destroy({ children: true })
  })
})

describe('Windfury wind lifecycle', () => {
  it('wraps the minion below badges, survives exhaustion, and releases its loop', async () => {
    const animate = vi.spyOn(AnimationScope.prototype, 'to')
    const view = await MinionView.create(
      { ...tauntMinion, windfury: true, frozen: true, divineShield: true },
      textures,
      undefined
    )
    try {
      const rear = view.getChildByLabel('minion.windfury.rear')!
      const front = view.getChildByLabel('minion.windfury.front')!
      const index = (label: string) => view.getChildIndex(view.getChildByLabel(label)!)
      expect(index('minion.windfury.rear')).toBeLessThan(index('minion.artwork'))
      expect(index('minion.windfury.front')).toBeGreaterThan(
        index('minion.divine-shield')
      )
      expect(index('minion.windfury.front')).toBeLessThan(index('minion.deathrattle'))
      expect(view.getChildByLabel('minion.windfury')).toBeNull()
      const loopIndex = animate.mock.calls.findIndex(
        ([target]) => 'phase' in (target as object)
      )
      expect(loopIndex).toBeGreaterThanOrEqual(0)
      const loop = animate.mock.results[loopIndex].value
      loop.progress(0.35)
      const phase = loop.progress()
      view.setWindfuryTuning({ ...WINDFURY_DEFAULTS, speed: 0, thickness: 2 })
      expect(loop.timeScale()).toBe(0)
      expect(loop.progress()).toBe(phase)
      view.setWindfuryTuning({ ...WINDFURY_DEFAULTS, speed: 2 })
      expect(loop.timeScale()).toBe(2)
      expect(loop.progress()).toBe(phase)
      view.setAbilityEffects({ ...tauntMinion, windfury: true })
      expect(loop.progress()).toBe(phase)
      view.setCanAttack(false)
      expect(rear.visible && front.visible).toBe(true)
      view.setAbilityEffects({ ...tauntMinion, windfury: false })
      expect(rear.visible || front.visible).toBe(false)
      expect(loop.parent).toBeNull()
      view.setAbilityEffects({ ...tauntMinion, windfury: true })
      expect(front.visible).toBe(true)
      view.destroy({ children: true })
      expect(rear.destroyed && front.destroyed).toBe(true)
    } finally {
      if (!view.destroyed) view.destroy({ children: true })
      animate.mockRestore()
    }
  })
})

describe('Persistent minion aura', () => {
  it.each(
    CARD_CATALOG.all
      .filter((card) => card.type === 'Minion' && card.auraVisual)
      .map((card) => card.id)
  )('connects %s to the shared aura on creation and state refresh', async (cardId) => {
    const definition = CARD_CATALOG.require(cardId)
    if (definition.type !== 'Minion') throw new Error('Expected a minion')
    const minion = {
      instanceId: cardId,
      cardId: definition.id,
      attack: definition.attack,
      health: definition.health,
      maxHealth: definition.health,
      keywords: definition.keywords,
      summonedOnTurn: 1,
      lastAttackedOnTurn: null
    } as BoardMinion
    const markers = boardMinionAbilityMarkers(minion, definition, 1)
    expect(markers.aura).toBe(true)
    const view = await MinionView.create(
      { ...tauntMinion, ...markers },
      textures,
      undefined
    )
    try {
      const aura = view.getChildByLabel('minion.aura')!
      expect(aura.visible).toBe(true)
      expect(aura.getChildByLabel('minion.aura.glow')).toBeInstanceOf(Sprite)
      view.setAbilityEffects(
        boardMinionAbilityMarkers({ ...minion, silenced: true }, definition, 1)
      )
      expect(aura.visible).toBe(false)
      view.setAbilityEffects(markers)
      expect(aura.visible).toBe(true)
      const transformed = CARD_CATALOG.require('basic_chillwind_yeti')
      view.setAbilityEffects(
        boardMinionAbilityMarkers({ ...minion, cardId: transformed.id }, transformed, 1)
      )
      expect(aura.visible).toBe(false)
    } finally {
      view.destroy({ children: true })
    }
  })

  it('samples the recovered expansion, fade and quiet interval', () => {
    expect(minionAuraSample(0)).toEqual({ size: 0, alpha: 1 })
    expect(minionAuraSample(0.5).alpha).toBe(1)
    expect(minionAuraSample(1.25).size).toBeCloseTo(0.7634128034)
    expect(minionAuraSample(2).alpha).toBeCloseTo(0.31502, 4)
    expect(minionAuraSample(2.5)).toEqual({ size: 0, alpha: 0 })
    expect(minionAuraSample(3.99)).toEqual({ size: 0, alpha: 0 })
    expect(minionAuraSample(4.5)).toEqual(minionAuraSample(0.5))
  })

  it('preserves phase on refresh, suppresses inactive minions and releases its clock', async () => {
    const animate = vi.spyOn(AnimationScope.prototype, 'to')
    const view = await MinionView.create(
      { ...tauntMinion, aura: true },
      textures,
      undefined
    )
    try {
      const aura = view.getChildByLabel('minion.aura')!
      const glow = aura.getChildByLabel('minion.aura.glow') as Sprite
      const loopIndex = animate.mock.calls.findIndex(
        ([target]) => 'seconds' in (target as object)
      )
      const loop = animate.mock.results[loopIndex].value
      const bodyBounds = view.getInteractionBounds()
      loop.totalTime(1.25)
      expect(glow.width).toBeGreaterThan(0)
      expect(view.getInteractionBounds()).toEqual(bodyBounds)
      expect(glow.width).toBeGreaterThan(bodyBounds.width)
      loop.totalTime(2)
      expect(glow.alpha).toBeCloseTo(0.63004, 4)
      loop.totalTime(1.25)
      const width = glow.width
      view.setAbilityEffects({ ...tauntMinion, aura: true })
      expect(loop.totalTime()).toBe(1.25)
      expect(glow.width).toBe(width)
      expect(aura.eventMode).toBe('none')
      expect(glow.blendMode).toBe('add')
      view.setDormant(true)
      expect(aura.visible).toBe(false)
      expect(loop.parent).toBeNull()
      view.setDormant(false)
      expect(aura.visible).toBe(true)
      expect(glow.width).toBe(0)
      view.setPendingDestruction(true)
      expect(aura.visible).toBe(false)
      view.setPendingDestruction(false)
      expect(aura.visible).toBe(true)
      view.setAbilityEffects({ ...tauntMinion, aura: false })
      expect(aura.visible).toBe(false)
      view.setAbilityEffects({ ...tauntMinion, aura: true })
      const lastLoop = animate.mock.results.at(-1)!.value
      view.destroy({ children: true })
      expect(lastLoop.parent).toBeNull()
      expect(aura.destroyed && glow.destroyed).toBe(true)
    } finally {
      if (!view.destroyed) view.destroy({ children: true })
      animate.mockRestore()
    }
  })

  it.each([{ dormant: true }, { pendingDestruction: true }])(
    'suppresses the aura at construction for %j',
    async (state) => {
      const view = await MinionView.create(
        { ...tauntMinion, aura: true, ...state },
        textures,
        undefined
      )
      expect(view.getChildByLabel('minion.aura')!.visible).toBe(false)
      view.destroy({ children: true })
    }
  )
})

describe('Windfury scene warm-up', () => {
  it.each([false, true])(
    'renders both portrait sizes offscreen and cleans up (failure: %s)',
    (fail) => {
      let root: Container | undefined
      let layers: Container[] = []
      let target: RenderTexture | undefined
      const render = vi.fn(
        (options: { container: Container; target: RenderTexture }) => {
          root = options.container
          target = options.target
          layers = [...root.children]
          expect(layers).toHaveLength(4)
          expect(layers.every((layer) => layer.visible)).toBe(true)
          if (fail) throw new Error('GPU unavailable')
        }
      )
      const renderer = { render } as unknown as Renderer
      if (fail) expect(() => prewarmWindfury(renderer)).toThrow('GPU unavailable')
      else prewarmWindfury(renderer)
      expect(render).toHaveBeenCalledOnce()
      expect(root?.destroyed).toBe(true)
      expect(target?.destroyed).toBe(true)
      expect(layers.every((layer) => layer.destroyed)).toBe(true)
    }
  )
})

describe('minion status curtains', () => {
  it('reuses warmed mask geometry and hides inactive masks', () => {
    const first = new MinionStatusCurtainEffect(Texture.WHITE, Texture.WHITE)
    const second = new MinionStatusCurtainEffect(Texture.WHITE, Texture.WHITE)
    try {
      const mask = (effect: MinionStatusCurtainEffect) =>
        effect.layer.getChildByLabel('minion.status-curtains.mask') as Graphics
      const context = mask(first).context
      expect(mask(second).context).toBe(context)
      expect(first.layer.visible).toBe(false)
      first.setState({ spellDamage: true, buffed: false, debuffed: false })
      expect(first.layer.visible).toBe(true)
      first.setState({ spellDamage: false, buffed: false, debuffed: false })
      expect(first.layer.visible).toBe(false)
      first.destroy()
      expect(context.destroyed).toBe(false)
      second.setState({ spellDamage: false, buffed: true, debuffed: false })
      expect(second.layer.visible).toBe(true)
    } finally {
      first.destroy()
      second.destroy()
    }
  })

  it('moves blue and orange upward and red downward without reallocating sprites', () => {
    const animate = vi.spyOn(AnimationScope.prototype, 'to')
    const effect = new MinionStatusCurtainEffect(Texture.WHITE, Texture.WHITE)
    try {
      effect.setState({ spellDamage: true, buffed: true, debuffed: true })
      const particles = ['spellDamage', 'buffed', 'debuffed'].map((kind) =>
        effect.layer.getChildByLabel(`minion.curtain.${kind}.0`, true)!
      )
      const loops = animate.mock.results.map((result) => result.value)
      for (const loop of loops) loop.progress(0.25)
      const before = particles.map((p) => p.y)
      for (const loop of loops) loop.progress(0.5)
      expect(particles[0].y).toBeLessThan(before[0])
      expect(particles[1].y).toBeLessThan(before[1])
      expect(particles[2].y).toBeGreaterThan(before[2])
      effect.setState({ spellDamage: true, buffed: true, debuffed: true })
      expect(animate).toHaveBeenCalledTimes(3)
      effect.destroy()
      for (const loop of loops) expect(loop.parent).toBeNull()
    } finally {
      effect.destroy()
      animate.mockRestore()
    }
  })
  it('overlays independent conditions, ignores damage, preserves loops, and cleans up', async () => {
    const animate = vi.spyOn(AnimationScope.prototype, 'to')
    const view = await MinionView.create(
      {
        ...tauntMinion,
        attack: 3,
        health: 4,
        maxHealth: 4,
        baseAttack: 3,
        baseHealth: 4
      },
      textures,
      undefined
    )
    try {
      const band = (name: string) =>
        view.getChildByLabel('minion.curtain.' + name, true)!
      const index = (label: string) => view.getChildIndex(view.getChildByLabel(label)!)
      expect(index('minion.status-curtains')).toBeGreaterThan(
        index('minion.frame-legendary')
      )
      expect(index('minion.status-curtains')).toBeLessThan(index('minion.frozen'))
      expect(view.getChildByLabel('minion.spell-damage')).toBeNull()
      view.setHealth(1)
      expect(band('debuffed').visible).toBe(false)
      view.setStats(5, 1, 2)
      view.setAbilityEffects({ ...tauntMinion, spellDamage: true })
      expect(band('spellDamage').visible).toBe(true)
      expect(band('buffed').visible).toBe(false)
      expect(band('debuffed').visible).toBe(false)
      const count = animate.mock.calls.length
      view.setStats(5, 1, 2)
      view.setAbilityEffects({ ...tauntMinion, spellDamage: true })
      expect(animate.mock.calls).toHaveLength(count)
      view.setBaseStats(3, 4)
      view.setAbilityEffects(tauntMinion)
      expect(['spellDamage', 'buffed', 'debuffed'].every((k) => !band(k).visible)).toBe(
        true
      )
      view.setPendingDestruction(true)
      expect(band('debuffed').visible).toBe(true)
      view.setPendingDestruction(false)
      expect(band('debuffed').visible).toBe(false)
      const curtain = view.getChildByLabel('minion.status-curtains')!
      view.destroy({ children: true })
      expect(curtain.destroyed).toBe(true)
      for (const result of animate.mock.results) expect(result.value.parent).toBeNull()
    } finally {
      if (!view.destroyed) view.destroy({ children: true })
      animate.mockRestore()
    }
  })

  it.each([false, true])(
    'warms both textures and mask, then cleans up (failure: %s)',
    (fail) => {
      let root: Container | undefined
      let target: RenderTexture | undefined
      const assets = {
        playSpotlight1: Texture.WHITE,
        playSpotlight4: Texture.WHITE
      } as GameAssets
      const renderer = {
        render(options: { container: Container; target: RenderTexture }) {
          root = options.container
          target = options.target
          for (const kind of ['spellDamage', 'buffed', 'debuffed']) {
            const layer = root.getChildByLabel('minion.curtain.' + kind, true)!
            expect(layer.visible).toBe(true)
            expect(layer.children).toHaveLength(18)
            expect(layer.children.some((p) => p.alpha > 0)).toBe(true)
          }
          if (fail) throw new Error('GPU unavailable')
        }
      } as unknown as Renderer
      if (fail)
        expect(() => prewarmMinionStatus(renderer, assets)).toThrow('GPU unavailable')
      else prewarmMinionStatus(renderer, assets)
      expect(root?.destroyed).toBe(true)
      expect(target?.destroyed).toBe(true)
      expect(Texture.WHITE.destroyed).toBe(false)
    }
  )
})

describe('AI attention and player hover', () => {
  it('keeps the shared white outline until both attention sources leave', async () => {
    const view = await MinionView.create(tauntMinion, textures, Texture.EMPTY)
    const outline = (view as unknown as { hoverOutline: { isEnabled(): boolean } })
      .hoverOutline
    view.setHoverAura(true)
    view.setAiAttention(true)
    view.setHoverAura(false)
    expect(outline.isEnabled()).toBe(true)
    view.setAiAttention(false)
    expect(outline.isEnabled()).toBe(false)
    view.setAiAttention(true)
    view.setHoverAura(true)
    view.setAiAttention(false)
    expect(outline.isEnabled()).toBe(true)
    view.setHoverAura(false)
    expect(outline.isEnabled()).toBe(false)
    view.destroy({ children: true })
  })
})

it('keeps attack warnings independent of attention and mouse hover', async () => {
  const view = await MinionView.create(tauntMinion, textures, Texture.EMPTY)
  const outline = (view as unknown as { hoverOutline: { isEnabled(): boolean } })
    .hoverOutline
  view.setAttackWarning(true)
  view.setAiAttention(false)
  view.setHoverAura(false)
  expect(outline.isEnabled()).toBe(true)
  view.setHoverAura(true)
  view.setAttackWarning(false)
  expect(outline.isEnabled()).toBe(true)
  view.setHoverAura(false)
  expect(outline.isEnabled()).toBe(false)
  view.destroy({ children: true })
})
