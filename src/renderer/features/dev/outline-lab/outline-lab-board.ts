import { Container, Rectangle, Sprite, type Renderer } from 'pixi.js'
import type {
  DeckPresentationAssets,
  GameAssets,
  CardAssetResolver
} from '../../../ui/asset-registry'
import { MinionView } from '../../../rendering/minions/minion-view'
import { HeroView } from '../../../rendering/heroes/hero-view'
import { HERO_LAYOUT } from '../../../rendering/heroes/hero-layout'
import {
  AnimatedOutline,
  type OutlinePalette,
  type OutlineTuning
} from '../../../rendering/effects/animated-outline'
import { BoardShadowLayer } from '../../../rendering/shadows/board-shadow-layer'
import { applyPlacement, applyAnchoredPlacement } from '../../../rendering/layout'
import { HeroPowerView } from '../../game/hero-power-view'
import { GAME_BOARD_LAYOUT } from '../../game/game-scene-layout'
import { OUTLINE_LAB_LAYOUT as LAYOUT } from './outline-lab-layout'

export class OutlineLabBoard extends Container {
  private readonly shadows: BoardShadowLayer
  private minion?: MinionView
  private hero?: HeroView
  private power?: HeroPowerView
  private disposed = false
  private heroHover?: AnimatedOutline
  private readonly resetHover: (() => void)[] = []

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
    applyPlacement(minion, LAYOUT.minion)
    minion.shadow.restingScale = LAYOUT.minion.scale?.x ?? 1
    minion.setCanAttack(true)
    minion.setHoverable(true)
    this.bindHover(minion, (enabled) => minion.setHoverAura(enabled))
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
    applyPlacement(this.hero, LAYOUT.hero)
    this.hero.setHealthVisible(true)
    this.hero.setCanAttack(true)
    this.hero.eventMode = 'static'
    const heroHoverTarget = new Sprite(heroes['hero-jaina'])
    heroHoverTarget.label = 'outline-lab.board.hero-hover-outline'
    heroHoverTarget.eventMode = 'none'
    applyAnchoredPlacement(heroHoverTarget, HERO_LAYOUT.frame)
    this.hero.addChildAt(
      heroHoverTarget,
      this.hero.getChildIndex(this.hero.getChildByLabel('hero.frame')!)
    )
    this.heroHover = new AnimatedOutline(heroHoverTarget, {
      palette: 'white',
      preset: 'board'
    })
    this.heroHover.setEnabled(false)
    this.bindHover(this.hero, (enabled) => this.heroHover?.setEnabled(enabled))
    this.addChild(this.hero)

    const power = new HeroPowerView({
      layout: { card: LAYOUT.power, ...GAME_BOARD_LAYOUT.heroPowers.manaOverlay },
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
    flipHost.label = 'outline-lab.board.hero-power-input'
    flipHost.hitArea = new Rectangle(
      LAYOUT.power.position.x - 90,
      LAYOUT.power.position.y - 90,
      180,
      180
    )
    flipHost.eventMode = 'static'
    flipHost.cursor = 'pointer'
    flipHost.addChild(power)
    let front = true
    let flipping = false
    let hovered = false
    this.bindHover(flipHost, (enabled) => {
      hovered = enabled
      power.setHoverAura(enabled && front && !flipping)
    })
    flipHost.on('pointertap', (event) => {
      if (event.button !== 0 || flipping) return
      event.stopPropagation()
      flipping = true
      front = !front
      power.setHoverAura(false)
      void (front ? power.flipUp() : power.flipDown()).finally(() => {
        flipping = false
        if (!this.disposed) power.setHoverAura(hovered && front)
      })
    })
    this.addChild(flipHost)
  }

  setAppearance(
    palette: OutlinePalette,
    tuning: OutlineTuning,
    hoverPalette: OutlinePalette
  ): void {
    this.minion?.setOutlineAppearance(palette, tuning, hoverPalette)
    this.hero?.setOutlineAppearance(palette, tuning)
    this.power?.setOutlineAppearance(palette, tuning, hoverPalette)
    this.heroHover?.setPalette(hoverPalette)
    this.heroHover?.setTuning(tuning)
  }

  clearHover(): void {
    for (const reset of this.resetHover) reset()
  }

  private bindHover(host: Container, setEnabled: (enabled: boolean) => void): void {
    host.on('pointerover', () => setEnabled(true))
    host.on('pointerout', () => setEnabled(false))
    this.resetHover.push(() => setEnabled(false))
  }

  update(deltaMS: number): void {
    if (this.visible && !this.disposed) this.shadows.update(deltaMS)
  }

  dispose(): void {
    if (this.disposed) return
    this.clearHover()
    this.disposed = true
    this.heroHover?.dispose()
    this.power?.dispose()
    this.destroy({ children: true })
  }
}
