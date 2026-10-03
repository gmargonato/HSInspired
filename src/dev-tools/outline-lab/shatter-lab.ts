import { SHATTER_CONFIG } from '../../visual-components/effects/outline-tuning'
import { Container, Text, type Renderer } from 'pixi.js'
import type {
  GameAssets,
  DeckPresentationAssets,
  CardAssetResolver
} from '../../visual-components/assets'
import { MinionView } from '../../scenes/match/board/minion-view'
import { WeaponView } from '../../scenes/match/board/weapon-view'
import { HeroView } from '../../scenes/match/board/hero-view'
import {
  createShatter,
  SHATTER_DEFAULTS,
  type ShatterTuning
} from '../../visual-components/effects/shatter'
import { applyPlacement } from '../../visual-components/layout'
import { OUTLINE_LAB_LAYOUT as LAYOUT } from './outline-lab-layout'

/** Standalone samples use the same snapshot shader as match deaths. */
export class ShatterLab extends Container {
  readonly tuning = { ...SHATTER_CONFIG }
  progress = 0
  private playing = false
  private disposed = false
  private readonly targets: Container[] = []
  private readonly shatters: ReturnType<typeof createShatter>[] = []
  constructor(private readonly renderer: Renderer) {
    super()
    this.label = 'outline-lab.shatter'
  }

  async mount(
    assets: GameAssets,
    heroes: DeckPresentationAssets,
    resolver: CardAssetResolver
  ): Promise<void> {
    const [artwork, weaponArt, attack, durability] = await Promise.all([
      resolver.loadArtwork('basic_chillwind_yeti'),
      resolver.loadArtwork('basic_fiery_war_axe'),
      resolver.load('card.stat.weapon-attack'),
      resolver.load('card.stat.weapon-durability')
    ])
    if (this.disposed) return
    const minion = await MinionView.create(
      {
        label: 'outline-lab.shatter.minion',
        attack: 4,
        health: 5,
        maxHealth: 5,
        legendary: false,
        taunt: false,
        enraged: false,
        divineShield: false,
        frozen: false,
        stealth: false,
        deathrattle: false,
        poisonous: false,
        aura: false,
        trigger: false,
        inspire: false,
        windfury: false,
        spellDamage: false,
        lifesteal: false,
        elusive: false,
        immune: false
      },
      {
        frame: assets.minionFrame,
        premiumFrame: assets.premiumMinionFrame,
        legendaryFrame: assets.minionFrameLegendary,
        premiumLegendaryFrame: assets.premiumMinionFrameLegendary,
        taunt: assets.minionTaunt,
        premiumTaunt: assets.premiumMinionTaunt,
        battlecry: assets.minionBattlecry,
        enrage: assets.minionEnrage,
        divineShield: assets.minionDivineShield,
        frozen: assets.minionFrozen,
        stealth: assets.minionStealth,
        curtainSpark: assets.playSpotlight4,
        curtainMote: assets.playSpotlight1,
        lifesteal: assets.minionLifesteal,
        aura: assets.minionAura,
        elusive: assets.minionElusive,
        immune: assets.minionImmune,
        trigger: assets.boardTrigger,
        inspire: assets.boardInspire,
        deathrattle: assets.boardDeathrattle,
        poisonous: assets.boardPoisonous,
        attack: assets.minionAttack,
        health: assets.minionHealth
      },
      artwork
    )
    if (this.disposed) {
      minion.destroy({ children: true })
      return
    }

    this.addChild(minion)
    this.targets.push(minion)
    applyPlacement(minion, LAYOUT.minion)
    const weapon = await WeaponView.create(
      {
        label: 'outline-lab.shatter.weapon',
        attack: 3,
        durability: 2,
        printedDurability: 2,
        deathrattle: false,
        trigger: false,
        lifesteal: false,
        temporaryAbilityLabels: []
      },
      {
        frame: assets.weapon,
        premiumFrame: assets.premiumWeapon,
        trigger: assets.boardTrigger,
        deathrattle: assets.boardDeathrattle,
        lifesteal: assets.minionLifesteal,
        attack,
        durability
      },
      weaponArt
    )
    if (this.disposed) {
      weapon.destroy({ children: true })
      return
    }
    this.addChild(weapon)
    this.targets.push(weapon)
    applyPlacement(weapon, LAYOUT.shatterWeapon)
    const hero = HeroView.create(
      {
        label: 'outline-lab.shatter.hero',
        attack: 0,
        health: 30,
        maxHealth: 30,
        armor: 0,
        frozen: false,
        immune: false
      },
      {
        frame: heroes['hero-jaina'],
        attack: assets.minionAttack,
        health: assets.minionHealth,
        armor: assets.heroArmor,
        frozen: assets.heroFrozen,
        immune: assets.heroImmune
      }
    )
    this.addChild(hero)
    this.targets.push(hero)
    applyPlacement(hero, LAYOUT.shatterHero)
    for (const [index, title] of ['Minion', 'Weapon', 'Hero portrait'].entries()) {
      const caption = new Text({
        text: title,
        style: { fontFamily: 'Arial', fontSize: 22, fill: 0xfff3dc }
      })
      caption.label = 'outline-lab.shatter.caption.' + index
      caption.anchor.set(0.5)
      caption.position.set(this.targets[index].x, LAYOUT.captionY)
      this.addChild(caption)
    }
  }

  play(): void {
    this.restore()
    this.playing = true
  }
  restore(): void {
    this.playing = false
    this.progress = 0
    for (const effect of this.shatters) effect.dispose()
    this.shatters.length = 0
  }
  set(key: string, value: number): void {
    const progress = key === 'progress' ? value : this.progress
    this.restore()
    if (key in this.tuning) this.tuning[key as keyof ShatterTuning] = value
    this.showProgress(progress)
  }
  reset(): void {
    this.restore()
    Object.assign(this.tuning, SHATTER_DEFAULTS)
  }
  private showProgress(progress: number): void {
    if (!this.shatters.length) {
      try {
        for (const target of this.targets)
          this.shatters.push(createShatter(this.renderer, target, this.tuning))
      } catch (error) {
        this.restore()
        throw error
      }
    }
    this.progress = progress
    for (const effect of this.shatters) effect.setProgress(progress)
  }
  update(deltaMS: number): void {
    if (!this.playing || this.disposed) return
    this.showProgress(
      Math.min(1, this.progress + Math.max(0, deltaMS) / (this.tuning.duration * 1000))
    )
    if (this.progress === 1) this.playing = false
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.restore()
    this.destroy({ children: true })
  }
}
