import { Container, Rectangle, type Renderer } from 'pixi.js'
import type {
  DeckPresentationAssets,
  GameAssets,
  CardAssetResolver
} from '../../visual-components/assets'
import { MinionView } from '../../scenes/match/board/minion-view'
import { HeroView } from '../../scenes/match/board/hero-view'
import { WeaponView } from '../../scenes/match/board/weapon-view'
import {
  type OutlinePalette,
  type OutlinePresetName,
  type OutlineTuning
} from '../../visual-components/effects/animated-outline'
import { BoardShadowLayer } from '../../scenes/match/board/board-shadow-layer'
import { applyPlacement } from '../../visual-components/layout'
import { HeroPowerView } from '../../scenes/match/board/hero-power-view'
import { GAME_BOARD_LAYOUT } from '../../scenes/match/game-scene-layout'
import { OUTLINE_LAB_LAYOUT as LAYOUT } from './outline-lab-layout'

export class OutlineLabBoard extends Container {
  private readonly shadows: BoardShadowLayer
  private minion?: MinionView
  private hero?: HeroView
  private power?: HeroPowerView
  private disposed = false
  private weapon?: WeaponView
  private powerHost?: Container
  private previewHover = false
  private restorePower: (() => void) | undefined

  constructor(renderer: Renderer) {
    super()
    this.label = 'outline-lab.board'
    this.shadows = new BoardShadowLayer(this, renderer)
    this.addChild(this.shadows)
  }

  async mount(
    assets: GameAssets,
    heroes: DeckPresentationAssets,
    resolver: CardAssetResolver
  ): Promise<void> {
    const artwork = await resolver.loadArtwork('basic_chillwind_yeti')
    if (this.disposed) return
    const minion = await MinionView.create(
      {
        label: 'outline-lab.board.minion',
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
        windfury: assets.minionWindfury,
        spellDamage: assets.minionSpellDamage,
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
    this.minion = minion
    applyPlacement(minion, LAYOUT.auraMinion)
    minion.shadow.restingScale = LAYOUT.auraMinion.scale?.x ?? 1
    minion.setCanAttack(true)
    minion.setHoverable(true)
    this.addChild(minion)

    this.hero = HeroView.create(
      {
        label: 'outline-lab.board.hero',
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
    applyPlacement(this.hero, LAYOUT.auraHero)
    this.hero.setHealthVisible(true)
    this.hero.setCanAttack(true)
    this.hero.eventMode = 'static'
    this.addChild(this.hero)

    const power = new HeroPowerView({
      layout: { card: LAYOUT.auraPower, ...GAME_BOARD_LAYOUT.heroPowers.manaOverlay },
      backTexture: assets.heroPowerBack,
      premiumBackTexture: assets.premiumHeroPowerBack,
      frontFrameTexture: assets.heroPowerFront,
      premiumFrameTexture: assets.premiumHeroPowerFront,
      artworkTexture: assets['hero-power-mage'],
      manaTexture: assets.heroPowerMana,
      cost: 2
    })
    this.power = power
    power.label = 'outline-lab.board.hero-power'
    power.setEnabled(true)
    // The match deliberately disables back-face clicks. This host allows repeated flips.
    power.eventMode = 'none'
    const flipHost = new Container()
    this.powerHost = flipHost
    flipHost.label = 'outline-lab.board.hero-power-input'
    flipHost.hitArea = new Rectangle(
      LAYOUT.auraPower.position.x - 90,
      LAYOUT.auraPower.position.y - 90,
      180,
      180
    )
    flipHost.eventMode = 'static'
    flipHost.cursor = 'pointer'
    flipHost.addChild(power)
    let front = true
    let flipping = false
    this.restorePower = () => {
      if (front) return
      front = true
      void power.flipUp().finally(() => {
        if (!this.disposed) power.setHoverAura(this.previewHover && front)
      })
    }
    flipHost.on('pointertap', (event) => {
      if (event.button !== 0 || flipping) return
      event.stopPropagation()
      flipping = true
      front = !front
      power.setHoverAura(false)
      void (front ? power.flipUp() : power.flipDown()).finally(() => {
        flipping = false
        if (!this.disposed) power.setHoverAura(this.previewHover && front)
      })
    })
    this.addChild(flipHost)
    const [weaponArt, attack, durability] = await Promise.all([
      resolver.loadArtwork('basic_fiery_war_axe'),
      resolver.load('card.stat.weapon-attack'),
      resolver.load('card.stat.weapon-durability')
    ])
    if (this.disposed) return
    const weapon = await WeaponView.create(
      {
        label: 'outline-lab.weapon',
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
    this.weapon = weapon
    applyPlacement(weapon, LAYOUT.auraWeapon)
    this.addChild(weapon)
  }

  selectElement(preset: OutlinePresetName): void {
    this.clearHover()
    if (this.minion) this.minion.visible = preset === 'minion'
    if (this.hero) this.hero.visible = preset === 'hero'
    if (this.powerHost) this.powerHost.visible = preset === 'hero-power'
    if (this.weapon) this.weapon.visible = preset === 'weapon'
  }

  setAppearance(
    preset: OutlinePresetName,
    palette: OutlinePalette,
    tuning: OutlineTuning,
    hoverPalette: OutlinePalette,
    hover: boolean
  ): void {
    if (preset === 'minion') {
      this.minion?.setOutlineAppearance(palette, tuning, hoverPalette)
      this.minion?.setCanAttack(!hover)
      this.minion?.setHoverAura(hover)
    } else if (preset === 'hero') {
      this.hero?.setOutlineAppearance(palette, tuning)
    } else if (preset === 'hero-power') {
      this.previewHover = hover
      this.power?.setOutlineAppearance(palette, tuning, hoverPalette)
      this.power?.setEnabled(!hover)
      if (this.power) this.power.eventMode = 'none'
      this.power?.setHoverAura(hover)
    } else if (preset === 'weapon') {
      this.weapon?.setOutlineAppearance(hoverPalette, tuning)
      this.weapon?.setHoverAura(true)
    }
  }

  clearHover(): void {
    this.previewHover = false
    if (!this.disposed) this.restorePower?.()
    this.minion?.setHoverAura(false)
    this.power?.setHoverAura(false)
    this.weapon?.setHoverAura(false)
  }

  update(deltaMS: number): void {
    if (this.visible && !this.disposed) this.shadows.update(deltaMS)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearHover()
    this.power?.dispose()
    this.destroy({ children: true })
  }
}
