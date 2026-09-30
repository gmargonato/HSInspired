import { Container, Sprite, type Texture } from 'pixi.js'
import { CARD_CATALOG } from '../../game-rules/content/cards'
import { HERO_CATALOG } from '../../game-rules/content/heroes'
import type { HeroPowerDefinition } from '../../game-rules/content/hero-powers'
import type { GameAssets, HeroAssets } from '../../visual-components/assets'
import { HeroView } from '../../scenes/match/board/hero-view'
import { MinionView } from '../../scenes/match/board/minion-view'
import { applyPlacement, applyAnchoredPlacement } from '../../visual-components/layout'
import { layoutBoardRow } from '../../scenes/match/board/board-layout'
import {
  PREVIEW_TARGETS,
  PREVIEW_LOCAL,
  type PreviewTarget
} from './hero-power-anim-model'
import { HERO_POWER_ANIM_LAYOUT as LAYOUT } from './hero-power-anim-layout'

export interface PreviewCharacter {
  readonly fixture: PreviewTarget
  readonly view: HeroView | MinionView
}

/** Static production views; no match engine, AI, or saved-state changes. */
export class HeroPowerAnimFixtures extends Container {
  readonly characters: PreviewCharacter[] = []

  constructor(
    private readonly assets: GameAssets,
    private readonly heroes: HeroAssets
  ) {
    super()
    this.label = 'hero-power-anim.fixtures'
    const background = new Sprite(assets.board1)
    background.label = 'hero-power-anim.board'
    background.eventMode = 'none'
    applyAnchoredPlacement(background, LAYOUT.board)
    this.addChild(background)
  }

  async mount(
    artwork: Texture,
    onTarget: (target: PreviewTarget) => void
  ): Promise<void> {
    const definition = CARD_CATALOG.require(LAYOUT.minion.cardId)
    if (definition.type !== 'Minion')
      throw new Error('Hero Power Anim requires a minion fixture')
    for (const fixture of PREVIEW_TARGETS) {
      if (this.destroyed) return
      const side = fixture.target.participantId === PREVIEW_LOCAL ? 'local' : 'remote'
      const view =
        fixture.target.kind === 'hero'
          ? this.createHero(side === 'local' ? 'garrosh' : 'guldan')
          : await MinionView.create(
              {
                label: `hero-power-anim.${fixture.key}`,
                attack: definition.attack,
                health: LAYOUT.minion.health,
                maxHealth: definition.health,
                baseAttack: definition.attack,
                baseHealth: definition.health,
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
                immune: false,
                premium: false,
                premiumSide: side
              },
              this.minionTextures(),
              artwork
            )
      if (this.destroyed) {
        view.destroy({ children: true })
        return
      }
      view.label = `hero-power-anim.${fixture.key}`
      view.ownerId = fixture.target.participantId
      if (view instanceof HeroView) {
        applyPlacement(view, LAYOUT.heroes[side])
        view.setHealthVisible(true)
      } else {
        const transform = layoutBoardRow(1, LAYOUT.minions[side])[0]
        view.position.set(transform.x, transform.y)
        view.scale.set(transform.scale)
        view.shadow.restingScale = transform.scale
        if (fixture.target.kind === 'minion')
          view.instanceId = fixture.target.instanceId
        view.cardId = definition.id
      }
      view.on('pointertap', (event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        onTarget(fixture)
      })
      this.characters.push({ fixture, view })
      this.addChild(view)
    }
  }

  setPower(power: HeroPowerDefinition): void {
    const hero = HERO_CATALOG.getPrimaryForClass(power.classId)
    const view = this.characters.find(
      ({ fixture }) => fixture.key === 'friendly-hero'
    )?.view
    if (hero && view instanceof HeroView)
      view.setFrame(this.heroes[hero.presentationAssetKey])
  }

  reset(): void {
    for (const { view } of this.characters) {
      if (view instanceof HeroView)
        view.setStats(
          LAYOUT.hero.attack,
          LAYOUT.hero.health,
          LAYOUT.hero.armor,
          LAYOUT.hero.maxHealth
        )
      else view.setHealth(LAYOUT.minion.health)
    }
  }

  private createHero(id: string): HeroView {
    return HeroView.create(
      { label: 'hero-power-anim.hero', ...LAYOUT.hero, frozen: false, immune: false },
      {
        frame: this.heroes[HERO_CATALOG.require(id).presentationAssetKey],
        attack: this.assets.minionAttack,
        health: this.assets.minionHealth,
        armor: this.assets.heroArmor,
        frozen: this.assets.heroFrozen,
        immune: this.assets.heroImmune
      }
    )
  }

  private minionTextures() {
    const a = this.assets
    return {
      frame: a.minionFrame,
      premiumFrame: a.premiumMinionFrame,
      legendaryFrame: a.minionFrameLegendary,
      premiumLegendaryFrame: a.premiumMinionFrameLegendary,
      taunt: a.minionTaunt,
      premiumTaunt: a.premiumMinionTaunt,
      battlecry: a.minionBattlecry,
      enrage: a.minionEnrage,
      divineShield: a.minionDivineShield,
      frozen: a.minionFrozen,
      stealth: a.minionStealth,
      windfury: a.minionWindfury,
      spellDamage: a.minionSpellDamage,
      lifesteal: a.minionLifesteal,
      aura: a.minionAura,
      elusive: a.minionElusive,
      immune: a.minionImmune,
      trigger: a.boardTrigger,
      inspire: a.boardInspire,
      deathrattle: a.boardDeathrattle,
      poisonous: a.boardPoisonous,
      attack: a.minionAttack,
      health: a.minionHealth
    }
  }
}
