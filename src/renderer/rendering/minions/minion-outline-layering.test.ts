import { Sprite, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../effects/animated-outline', () => ({
  AnimatedOutline: class {
    setEnabled(): void {}
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
import { WeaponView, type WeaponViewTextures } from '../weapons/weapon-view'
import { setPremiumEnabled, setPremiumMode } from '../premium-appearance'

const textures: MinionViewTextures = {
  windfury: Texture.EMPTY,
  spellDamage: Texture.EMPTY,
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
      attack: Texture.EMPTY,
      durability: Texture.EMPTY
    }
    const model = {
      label: 'test.weapon',
      attack: 2,
      durability: 2,
      deathrattle: false,
      trigger: false,
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
    const view = await MinionView.create(tauntMinion, textures, undefined)
    const sprites = [
      'windfury',
      'spell-damage',
      'lifesteal',
      'aura',
      'elusive',
      'immune'
    ].map((name) => view.children.find((child) => child.label === 'minion.' + name)!)
    expect(sprites.every((sprite) => !sprite.visible)).toBe(true)
    view.setAbilityEffects({
      windfury: true,
      spellDamage: true,
      lifesteal: true,
      aura: true,
      elusive: true,
      immune: true
    })
    expect(sprites.every((sprite) => sprite.visible)).toBe(true)
    view.setAbilityEffects({
      windfury: false,
      spellDamage: false,
      lifesteal: false,
      aura: false,
      elusive: false,
      immune: false
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
})
