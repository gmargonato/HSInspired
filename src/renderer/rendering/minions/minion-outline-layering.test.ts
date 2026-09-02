import { Texture } from 'pixi.js'
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

const textures: MinionViewTextures = {
  frame: Texture.EMPTY,
  legendaryFrame: Texture.EMPTY,
  taunt: Texture.EMPTY,
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
  divineShield: false,
  stealth: false,
  frozen: false,
  deathrattle: false,
  poisonous: true,
  trigger: false,
  inspire: false,
  temporaryAbilityLabels: []
}

describe('MinionView outline layering', () => {
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
    expect(childIndex('minion.frozen')).toBeLessThan(childIndex('minion.stealth'))
    expect(childIndex('minion.deathrattle')).toBeLessThan(childIndex('minion.trigger'))
    expect(childIndex('minion.deathrattle')).toBeLessThan(
      childIndex('minion.poisonous')
    )
    expect(childIndex('minion.trigger')).toBeLessThan(childIndex('minion.inspire'))

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
