import { prewarmMinionStatus } from '../loading/minion-status-warmup'
import { MinionStatusCurtainEffect } from './minion-status-curtain-effect'
import type { GameAssets } from '../../../visual-components/assets'
import { prewarmWindfury } from '../loading/windfury-warmup'
import { WINDFURY_DEFAULTS } from '../../../desktop/contracts/ipc/windfury-tuning'
import type { Container, Renderer, RenderTexture } from 'pixi.js'
import { AnimationScope } from '../../../visual-components/animation/animations'
import { Graphics, Sprite, Text, Texture } from 'pixi.js'
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

describe('MinionView outline layering', () => {
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
    expect(childIndex('minion.stat-health')).toBeLessThan(childIndex('minion.aura'))
    expect(childIndex('minion.aura')).toBe(view.children.length - 2)

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
